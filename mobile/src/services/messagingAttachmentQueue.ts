import { File, Paths } from 'expo-file-system';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { messagingApi } from './endpoints';
import { getStoredSession } from './tokenStorage';

export type QueuedAttachment = { id: string; fileName: string; mimeType: string; dataBase64: string; status: 'PENDING' | 'UPLOADING' | 'FAILED' | 'QUEUED_FOR_SCAN'; progress: number; error?: string; createdAt: string };
export type AttachmentOwner = { userId: string; businessId: string };
const memoryQueues = new Map<string, QueuedAttachment[]>();
const operations = new Map<string, Promise<unknown>>();
const MAX_BASE64_BYTES = 28 * 1024 * 1024;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
let legacyMigration: Promise<void> | undefined;

function ownerKey(owner: AttachmentOwner) {
  if (!owner || ![owner.userId, owner.businessId].every(id => /^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error('Sign in to manage attachments.');
  return `${owner.userId}.${owner.businessId}`;
}
async function sessionFor(owner: AttachmentOwner) {
  ownerKey(owner);
  const session = await getStoredSession();
  if (!session || session.ownerUserId !== owner.userId || session.ownerBusinessId !== owner.businessId) throw new Error('Your session changed. Please reopen uploads.');
  return session;
}
async function serialize<T>(owner: AttachmentOwner, action: () => Promise<T>): Promise<T> {
  const key = ownerKey(owner);
  const pending = (operations.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    await sessionFor(owner);
    if (Platform.OS !== 'web') {
      legacyMigration ??= quarantineLegacy().catch(error => { legacyMigration = undefined; throw error; });
      await legacyMigration;
    }
    return action();
  });
  operations.set(key, pending);
  try { return await pending; } finally { if (operations.get(key) === pending) operations.delete(key); }
}
function queueFile(key: string) { return new File(Paths.document, `attachment-queue-v2-${key}.enc`); }
async function encryptionKey(key: string, mustExist: boolean) {
  const name = `chakusa.attachments.v2.${key}`;
  const encoded = await SecureStore.getItemAsync(name);
  if (encoded) return AESEncryptionKey.import(encoded, 'hex');
  if (mustExist) throw new Error('The encrypted upload queue is unavailable. Please select the files again.');
  const created = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(name, await created.encoded('hex'), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return created;
}
async function quarantineLegacy() {
  // The old file has no trustworthy account identity. Preserve it encrypted
  // for recovery, but never import it into whichever account signs in next.
  const legacy = new File(Paths.document, 'messaging-attachment-queue.json');
  if (!legacy.exists) return;
  if (legacy.size > MAX_BASE64_BYTES) throw new Error('The legacy upload queue needs recovery before adding files.');
  const quarantine = new File(Paths.document, 'attachment-queue-legacy-quarantine.enc');
  const plain = await legacy.bytes();
  const sealed = await aesEncryptAsync(plain, await encryptionKey('legacy-quarantine', quarantine.exists));
  const encrypted = await sealed.combined();
  quarantine.create({ overwrite: true, intermediates: true });
  quarantine.write(encrypted);
  if (quarantine.size !== encrypted.byteLength) throw new Error('Unable to protect the legacy upload queue.');
  legacy.delete();
}
function validate(items: unknown): QueuedAttachment[] {
  if (!Array.isArray(items) || items.length > 20) throw new Error('Invalid upload queue.');
  let bytes = 0;
  return items.filter((item): item is QueuedAttachment => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.fileName !== 'string' || typeof item.mimeType !== 'string' || typeof item.dataBase64 !== 'string' || typeof item.createdAt !== 'string' || !['PENDING', 'UPLOADING', 'FAILED', 'QUEUED_FOR_SCAN'].includes(item.status)) throw new Error('Invalid upload queue.');
    bytes += item.dataBase64.length;
    if (bytes > MAX_BASE64_BYTES || item.fileName.length > 255) throw new Error('Upload queue size limit reached.');
    const age = Date.now() - Date.parse(item.createdAt);
    return Number.isFinite(age) && age >= 0 && age < MAX_AGE_MS;
  }).map(item => item.status === 'UPLOADING' ? { ...item, status: 'PENDING', progress: 0 } : item);
}
async function readQueue(owner: AttachmentOwner): Promise<QueuedAttachment[]> {
  const key = ownerKey(owner);
  if (Platform.OS === 'web') { const items = validate(memoryQueues.get(key) ?? []); memoryQueues.set(key, items); return items; }
  const file = queueFile(key);
  if (!file.exists) return [];
  const plain = await aesDecryptAsync(AESSealedData.fromCombined(await file.bytes()), await encryptionKey(key, true));
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
  const items = validate(parsed);
  if (Array.isArray(parsed) && parsed.length !== items.length) await writeQueue(owner, items);
  return items;
}
async function writeQueue(owner: AttachmentOwner, items: QueuedAttachment[]) {
  await sessionFor(owner);
  const key = ownerKey(owner);
  if (Platform.OS === 'web') { memoryQueues.set(key, items); return; }
  const file = queueFile(key);
  const sealed = await aesEncryptAsync(new TextEncoder().encode(JSON.stringify(items)), await encryptionKey(key, file.exists));
  const encrypted = await sealed.combined();
  await sessionFor(owner);
  if (!file.exists) file.create({ intermediates: true });
  file.write(encrypted);
}
export async function queuedAttachments(owner: AttachmentOwner) {
  return serialize(owner, async () => { const items = await readQueue(owner); await sessionFor(owner); return items; });
}
export async function enqueueAttachment(input: Omit<QueuedAttachment, 'id' | 'status' | 'progress' | 'createdAt'>, owner: AttachmentOwner) {
  return serialize(owner, async () => {
    const items = await readQueue(owner);
    const item: QueuedAttachment = { ...input, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, status: 'PENDING', progress: 0, createdAt: new Date().toISOString() };
    if (items.length >= 20) throw new Error('Upload queue size limit reached.');
    validate([...items, item]);
    await writeQueue(owner, [...items, item]);
    return item;
  });
}
export async function flushAttachmentQueue(onChange: ((items: QueuedAttachment[]) => void) | undefined, owner: AttachmentOwner) {
  return serialize(owner, async () => {
    let items = await readQueue(owner);
    for (const item of items.filter(row => row.status === 'PENDING' || row.status === 'FAILED')) {
      const session = await sessionFor(owner);
      items = items.map(row => row.id === item.id ? { ...row, status: 'UPLOADING', progress: 25, error: undefined } : row);
      await writeQueue(owner, items);
      onChange?.(items);
      try {
        await messagingApi.uploadAttachment(item, session.accessToken);
        await sessionFor(owner);
        items = items.map(row => row.id === item.id ? { ...row, status: 'QUEUED_FOR_SCAN', progress: 100, dataBase64: '' } : row);
      } catch {
        await sessionFor(owner);
        items = items.map(row => row.id === item.id ? { ...row, status: 'FAILED', progress: 0, error: 'Upload failed. Please retry.' } : row);
      }
      await writeQueue(owner, items);
      onChange?.(items);
    }
    await sessionFor(owner);
    return items;
  });
}
export async function removeQueuedAttachment(id: string, owner: AttachmentOwner) {
  return serialize(owner, async () => { const items = (await readQueue(owner)).filter(item => item.id !== id); await writeQueue(owner, items); return items; });
}
