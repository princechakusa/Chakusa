import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { prisma } from "../prisma.js";

export interface AttachmentStorage {
  readonly id?: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  health?(): Promise<{ available: boolean; detail?: string }>;
}
export interface MalwareScanner { scan(body: Buffer, declaredMime: string): Promise<{ clean: boolean; detectedMime?: string; detail?: string }> }
export interface ProviderMediaPreparer { prepare(input: { storageKey: string; fileName: string; mimeType: string; body: Buffer; idempotencyKey: string }): Promise<{ providerMediaId: string }> }

class MemoryStorage implements AttachmentStorage {
  readonly id = "memory";
  private objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer) { this.objects.set(key, Buffer.from(body)); }
  async get(key: string) { return this.objects.get(key) ?? null; }
  async remove(key: string) { this.objects.delete(key); }
}
class UnavailableStorage implements AttachmentStorage {
  readonly id = "unconfigured";
  async put(): Promise<void> { throw ApiError.serviceUnavailable("Attachment storage is not configured"); }
  async get(): Promise<null> { throw ApiError.serviceUnavailable("Attachment storage is not configured"); }
  async remove(): Promise<void> { throw ApiError.serviceUnavailable("Attachment storage is not configured"); }
  async health() { return { available: false, detail: "Attachment storage adapter is not configured" }; }
}
let storage: AttachmentStorage = config.NODE_ENV === "production" ? new UnavailableStorage() : new MemoryStorage();
let scanner: MalwareScanner = { scan: async (_body, declaredMime) => ({ clean: true, detectedMime: declaredMime }) };
export function configureAttachmentPlatform(input: { storage: AttachmentStorage; scanner: MalwareScanner }) { storage = input.storage; scanner = input.scanner; }
export async function attachmentStorageHealth() { return storage.health ? storage.health() : { available: true, detail: storage.id ?? "configured" }; }

function token(id: string, businessId: string, operation: "upload" | "download", expiresAt: number) {
  const payload = `${id}.${businessId}.${operation}.${expiresAt}`;
  return `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", config.JWT_SECRET).update(payload).digest("base64url")}`;
}
function verifyToken(value: string, operation: "upload" | "download") {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid attachment token");
  const payload = Buffer.from(encoded, "base64url").toString("utf8"); const [id, businessId, op, expires] = payload.split(".");
  const expected = createHmac("sha256", config.JWT_SECRET).update(payload).digest(); const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied) || op !== operation) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid attachment token");
  if (Number(expires) <= Date.now()) throw ApiError.auth(410, "AUTH_TOKEN_INVALID", "Attachment token has expired");
  return { id, businessId };
}

export async function initiateAttachment(businessId: string, input: { messageId?: string; fileName: string; mimeType: string; sizeBytes: number; checksumSha256: string; retentionDays?: number }) {
  if (input.sizeBytes < 1 || input.sizeBytes > 20 * 1024 * 1024) throw ApiError.badRequest("Attachment must be between 1 byte and 20 MB");
  if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) throw ApiError.badRequest("A SHA-256 checksum is required");
  if (input.messageId && !(await prisma.message.findFirst({ where: { id: input.messageId, businessId }, select: { id: true } }))) throw ApiError.notFound("Message not found");
  const id = randomUUID(); const storageKey = `${businessId}/${id}`;
  const attachment = await prisma.messageAttachment.create({ data: { id, businessId, messageId: input.messageId, storageKey, fileName: input.fileName, declaredMime: input.mimeType, sizeBytes: input.sizeBytes, checksumSha256: input.checksumSha256.toLowerCase(), retentionUntil: new Date(Date.now() + (input.retentionDays ?? 30) * 86_400_000), events: { create: { businessId, type: "UPLOAD_INITIATED", status: "PENDING" } } } });
  const expiresAt = Date.now() + 15 * 60_000;
  return { attachment, uploadToken: token(id, businessId, "upload", expiresAt), expiresAt: new Date(expiresAt) };
}

export async function uploadAttachment(uploadToken: string, body: Buffer, contentType: string) {
  const claim = verifyToken(uploadToken, "upload"); const attachment = await prisma.messageAttachment.findFirst({ where: { id: claim.id, businessId: claim.businessId, deletedAt: null } });
  if (!attachment) throw ApiError.notFound("Attachment not found");
  if (body.length !== attachment.sizeBytes || createHash("sha256").update(body).digest("hex") !== attachment.checksumSha256) throw ApiError.badRequest("Attachment size or checksum does not match upload declaration");
  try { await storage.put(attachment.storageKey, body, contentType); } catch (error) { await prisma.messageAttachment.update({ where: { id: attachment.id }, data: { uploadStatus: "RETRY", retryCount: { increment: 1 }, lastError: error instanceof Error ? error.message : "Storage upload failed" } }); await prisma.attachmentProcessingEvent.create({ data: { businessId: attachment.businessId, attachmentId: attachment.id, type: "UPLOAD", status: "FAILED", detail: error instanceof Error ? error.message : "Storage upload failed" } }); throw error; }
  await prisma.$transaction([prisma.messageAttachment.update({ where: { id: attachment.id }, data: { uploadStatus: "UPLOADED", malwareScanStatus: "PENDING", lastError: null } }), prisma.attachmentProcessingEvent.create({ data: { businessId: attachment.businessId, attachmentId: attachment.id, type: "UPLOAD_COMPLETED", status: "QUEUED" } })]);
  return prisma.messageAttachment.findUniqueOrThrow({ where: { id: attachment.id } });
}

export async function processAttachmentScans(limit = 20) {
  const rows = await prisma.messageAttachment.findMany({ where: { uploadStatus: "UPLOADED", malwareScanStatus: { in: ["PENDING", "RETRY"] }, deletedAt: null }, orderBy: { createdAt: "asc" }, take: limit });
  for (const attachment of rows) {
    const claimed = await prisma.messageAttachment.updateMany({ where: { id: attachment.id, uploadStatus: "UPLOADED", malwareScanStatus: { in: ["PENDING", "RETRY"] } }, data: { uploadStatus: "SCANNING", malwareScanStatus: "SCANNING" } }); if (!claimed.count) continue;
    try { const body = await storage.get(attachment.storageKey); if (!body) throw new Error("Stored attachment content is unavailable"); const scan = await scanner.scan(body, attachment.declaredMime); await prisma.$transaction([prisma.messageAttachment.update({ where: { id: attachment.id }, data: { uploadStatus: scan.clean ? "READY" : "QUARANTINED", malwareScanStatus: scan.clean ? "CLEAN" : "INFECTED", detectedMime: scan.detectedMime, lastError: scan.clean ? null : scan.detail ?? "Malware scan rejected attachment" } }), prisma.attachmentProcessingEvent.create({ data: { businessId: attachment.businessId, attachmentId: attachment.id, type: "MALWARE_SCAN", status: scan.clean ? "CLEAN" : "INFECTED", detail: scan.detail } })]); if (!scan.clean) await storage.remove(attachment.storageKey); } catch (error) { await prisma.$transaction([prisma.messageAttachment.update({ where: { id: attachment.id }, data: { uploadStatus: "UPLOADED", malwareScanStatus: "RETRY", retryCount: { increment: 1 }, lastError: error instanceof Error ? error.message : "Attachment scan failed" } }), prisma.attachmentProcessingEvent.create({ data: { businessId: attachment.businessId, attachmentId: attachment.id, type: "MALWARE_SCAN", status: "FAILED", detail: error instanceof Error ? error.message : "Attachment scan failed" } })]); }
  }
  return rows.length;
}
export async function rescanAttachment(businessId: string, id: string) { const changed = await prisma.messageAttachment.updateMany({ where: { id, businessId, deletedAt: null, uploadStatus: { in: ["READY", "QUARANTINED", "UPLOADED"] } }, data: { uploadStatus: "UPLOADED", malwareScanStatus: "PENDING", lastError: null } }); if (!changed.count) throw ApiError.conflict("Attachment cannot be rescanned from its current state"); await prisma.attachmentProcessingEvent.create({ data: { businessId, attachmentId: id, type: "RESCAN_REQUESTED", status: "QUEUED" } }); }
export async function recoverAttachmentProcessing() { const changed = await prisma.messageAttachment.updateMany({ where: { uploadStatus: "SCANNING", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { uploadStatus: "UPLOADED", malwareScanStatus: "RETRY", lastError: "Scan worker lease expired" } }); return changed.count; }

export async function createAttachmentDownload(businessId: string, id: string) {
  const attachment = await prisma.messageAttachment.findFirst({ where: { id, businessId, deletedAt: null, uploadStatus: "READY", malwareScanStatus: "CLEAN", OR: [{ retentionUntil: null }, { retentionUntil: { gt: new Date() } }] } });
  if (!attachment) throw ApiError.notFound("Downloadable attachment not found"); const expiresAt = Date.now() + 5 * 60_000;
  return { token: token(id, businessId, "download", expiresAt), expiresAt: new Date(expiresAt), fileName: attachment.fileName, mimeType: attachment.detectedMime ?? attachment.declaredMime };
}
export async function downloadAttachment(downloadToken: string) { const claim = verifyToken(downloadToken, "download"); const attachment = await prisma.messageAttachment.findFirst({ where: { id: claim.id, businessId: claim.businessId, uploadStatus: "READY", malwareScanStatus: "CLEAN", deletedAt: null } }); if (!attachment) throw ApiError.notFound("Attachment not found"); const body = await storage.get(attachment.storageKey); if (!body) throw ApiError.notFound("Attachment content not found"); return { attachment, body }; }
export async function prepareProviderMedia(businessId: string, id: string, preparer: ProviderMediaPreparer) { const attachment = await prisma.messageAttachment.findFirst({ where: { id, businessId, uploadStatus: "READY", malwareScanStatus: "CLEAN", deletedAt: null } }); if (!attachment) throw ApiError.notFound("Attachment not ready"); if (attachment.providerMediaId) return attachment; const body = await storage.get(attachment.storageKey); if (!body) throw ApiError.notFound("Attachment content not found"); try { const result = await preparer.prepare({ storageKey: attachment.storageKey, fileName: attachment.fileName, mimeType: attachment.detectedMime ?? attachment.declaredMime, body, idempotencyKey: attachment.id }); return await prisma.messageAttachment.update({ where: { id }, data: { providerMediaId: result.providerMediaId, retryCount: { increment: 1 }, lastError: null } }); } catch (error) { await prisma.messageAttachment.update({ where: { id }, data: { retryCount: { increment: 1 }, lastError: error instanceof Error ? error.message : "Provider media preparation failed" } }); throw error; } }
export async function expireAttachments(now = new Date()) { const expired = await prisma.messageAttachment.findMany({ where: { retentionUntil: { lte: now }, deletedAt: null } }); for (const item of expired) { await storage.remove(item.storageKey); await prisma.messageAttachment.update({ where: { id: item.id }, data: { deletedAt: now, uploadStatus: "EXPIRED" } }); } return expired.length; }
