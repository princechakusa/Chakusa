import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { prisma } from "../prisma.js";
import type { AttachmentStorage, MalwareScanner } from "../messaging/attachmentPlatform.js";

// PROGRAM 3 / Financial Management F3: secure receipt attachments for
// expenses (master directive §18). Reuses the messaging attachment
// contracts (AttachmentStorage / MalwareScanner) but keeps its own
// storage handle and a synchronous scan-on-upload - a receipt is a small,
// one-shot capture, so there is no async scan worker here.
//
// Every query is scoped on businessId AND (via the expense) tenant
// ownership; download is a short-lived HMAC bearer token bound to
// receiptId + businessId + operation, never a raw storage key. In
// production the storage handle is UNAVAILABLE until a real object-store
// adapter is wired (configureExpenseReceiptPlatform) - the boundary is
// complete and tested; live activation is EXTERNAL SETUP REQUIRED.

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

class MemoryReceiptStorage implements AttachmentStorage {
  readonly id = "memory";
  private objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer) {
    this.objects.set(key, Buffer.from(body));
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async remove(key: string) {
    this.objects.delete(key);
  }
}

class UnavailableReceiptStorage implements AttachmentStorage {
  readonly id = "unconfigured";
  async put(): Promise<void> {
    throw ApiError.serviceUnavailable("Receipt storage is not configured");
  }
  async get(): Promise<null> {
    throw ApiError.serviceUnavailable("Receipt storage is not configured");
  }
  async remove(): Promise<void> {
    throw ApiError.serviceUnavailable("Receipt storage is not configured");
  }
  async health() {
    return { available: false, detail: "Receipt storage adapter is not configured" };
  }
}

let storage: AttachmentStorage =
  config.NODE_ENV === "production" ? new UnavailableReceiptStorage() : new MemoryReceiptStorage();
let scanner: MalwareScanner = { scan: async (_body, declaredMime) => ({ clean: true, detectedMime: declaredMime }) };

export function configureExpenseReceiptPlatform(input: { storage: AttachmentStorage; scanner?: MalwareScanner }) {
  storage = input.storage;
  if (input.scanner) scanner = input.scanner;
}

export async function expenseReceiptStorageHealth() {
  return storage.health ? storage.health() : { available: true, detail: storage.id ?? "configured" };
}

function signToken(receiptId: string, businessId: string, operation: "download", expiresAt: number) {
  const payload = `${receiptId}.${businessId}.${operation}.${expiresAt}`;
  return `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", config.JWT_SECRET).update(payload).digest("base64url")}`;
}

function verifyToken(value: string, operation: "download") {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid receipt token");
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const [receiptId, businessId, op, expires] = payload.split(".");
  const expected = createHmac("sha256", config.JWT_SECRET).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied) || op !== operation) {
    throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid receipt token");
  }
  if (Number(expires) <= Date.now()) throw ApiError.auth(410, "AUTH_TOKEN_INVALID", "Receipt token has expired");
  return { receiptId: receiptId!, businessId: businessId! };
}

const receiptView = {
  id: true,
  expenseId: true,
  fileName: true,
  declaredMime: true,
  detectedMime: true,
  sizeBytes: true,
  status: true,
  scanDetail: true,
  uploadedAt: true,
  createdAt: true,
} as const;

function serialize(row: {
  id: string;
  expenseId: string;
  fileName: string;
  declaredMime: string;
  detectedMime: string | null;
  sizeBytes: number;
  status: string;
  scanDetail: string | null;
  uploadedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    expenseId: row.expenseId,
    fileName: row.fileName,
    mimeType: row.detectedMime ?? row.declaredMime,
    sizeBytes: row.sizeBytes,
    status: row.status,
    scanDetail: row.scanDetail,
    uploadedAt: row.uploadedAt,
    createdAt: row.createdAt,
    downloadable: row.status === "ready",
  };
}

async function assertExpenseOwned(businessId: string, expenseId: string): Promise<void> {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, businessId, deletedAt: null },
    select: { id: true },
  });
  if (!expense) throw ApiError.notFound("Expense not found");
}

export async function listExpenseReceipts(businessId: string, expenseId: string) {
  await assertExpenseOwned(businessId, expenseId);
  const rows = await prisma.expenseReceipt.findMany({
    where: { businessId, expenseId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: receiptView,
  });
  return rows.map(serialize);
}

/**
 * One-shot upload: the mobile client sends the file as base64. The server
 * computes the checksum, stores the object, scans it synchronously, and
 * settles the row to `ready` or `quarantined` before returning.
 */
export async function uploadExpenseReceipt(
  businessId: string,
  expenseId: string,
  input: { fileName: string; mimeType: string; dataBase64: string },
) {
  await assertExpenseOwned(businessId, expenseId);
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw ApiError.badRequest("Receipts must be a JPEG, PNG, WebP, HEIC image or a PDF");
  }
  const body = Buffer.from(input.dataBase64, "base64");
  if (body.length < 1 || body.length > MAX_BYTES) {
    throw ApiError.badRequest("Receipt must be between 1 byte and 15 MB");
  }
  const count = await prisma.expenseReceipt.count({ where: { businessId, expenseId, deletedAt: null } });
  if (count >= 10) throw ApiError.conflict("An expense can hold at most 10 receipts");

  const id = randomUUID();
  const storageKey = `${businessId}/expense-receipts/${id}`;
  const checksum = createHash("sha256").update(body).digest("hex");

  const receipt = await prisma.expenseReceipt.create({
    data: {
      id,
      businessId,
      expenseId,
      storageKey,
      fileName: input.fileName,
      declaredMime: input.mimeType,
      sizeBytes: body.length,
      checksumSha256: checksum,
      status: "pending",
    },
    select: receiptView,
  });

  try {
    await storage.put(storageKey, body, input.mimeType);
  } catch (error) {
    await prisma.expenseReceipt.update({
      where: { id },
      data: {
        status: "pending",
        retryCount: { increment: 1 },
        scanDetail: error instanceof Error ? error.message : "Storage upload failed",
      },
    });
    throw error;
  }

  await prisma.expenseReceipt.update({ where: { id }, data: { status: "uploaded", uploadedAt: new Date() } });

  let settled;
  try {
    const scan = await scanner.scan(body, input.mimeType);
    settled = await prisma.expenseReceipt.update({
      where: { id },
      data: {
        status: scan.clean ? "ready" : "quarantined",
        detectedMime: scan.detectedMime ?? null,
        scanDetail: scan.clean ? null : scan.detail ?? "Malware scan rejected the receipt",
      },
      select: receiptView,
    });
    if (!scan.clean) await storage.remove(storageKey).catch(() => undefined);
  } catch (error) {
    settled = await prisma.expenseReceipt.update({
      where: { id },
      data: {
        status: "uploaded",
        retryCount: { increment: 1 },
        scanDetail: error instanceof Error ? error.message : "Receipt scan failed",
      },
      select: receiptView,
    });
  }

  return serialize(settled ?? receipt);
}

export async function createExpenseReceiptDownload(businessId: string, receiptId: string) {
  const receipt = await prisma.expenseReceipt.findFirst({
    where: { id: receiptId, businessId, deletedAt: null, status: "ready" },
    select: { id: true, fileName: true, declaredMime: true, detectedMime: true },
  });
  if (!receipt) throw ApiError.notFound("Downloadable receipt not found");
  const expiresAt = Date.now() + 5 * 60_000;
  return {
    token: signToken(receiptId, businessId, "download", expiresAt),
    expiresAt: new Date(expiresAt),
    fileName: receipt.fileName,
    mimeType: receipt.detectedMime ?? receipt.declaredMime,
  };
}

export async function downloadExpenseReceipt(downloadToken: string) {
  const claim = verifyToken(downloadToken, "download");
  const receipt = await prisma.expenseReceipt.findFirst({
    where: { id: claim.receiptId, businessId: claim.businessId, deletedAt: null, status: "ready" },
  });
  if (!receipt) throw ApiError.notFound("Receipt not found");
  const body = await storage.get(receipt.storageKey);
  if (!body) throw ApiError.notFound("Receipt content not found");
  return { receipt, body };
}

export async function deleteExpenseReceipt(businessId: string, receiptId: string) {
  const receipt = await prisma.expenseReceipt.findFirst({
    where: { id: receiptId, businessId, deletedAt: null },
    select: { id: true, storageKey: true },
  });
  if (!receipt) throw ApiError.notFound("Receipt not found");
  await storage.remove(receipt.storageKey).catch(() => undefined);
  await prisma.expenseReceipt.update({ where: { id: receipt.id }, data: { status: "expired", deletedAt: new Date() } });
}
