import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: { accessToken: 'access-a', refreshToken: 'refresh-a', ownerUserId: 'user-a', ownerBusinessId: 'business-a' },
  upload: vi.fn(async () => ({ id: 'uploaded' })),
  os: 'web', files: new Map<string, Uint8Array>(), keys: new Map<string, string>(),
}));
vi.mock('react-native', () => ({ Platform: { get OS() { return state.os; } } }));
vi.mock('expo-file-system', () => ({ File: class {
  key: string; constructor(_root: string, name: string) { this.key = name; }
  get exists() { return state.files.has(this.key); }
  get size() { return state.files.get(this.key)?.length ?? 0; }
  create() { state.files.set(this.key, new Uint8Array()); }
  write(bytes: Uint8Array) { state.files.set(this.key, new Uint8Array(bytes)); }
  async bytes() { return state.files.get(this.key)!; }
  delete() { state.files.delete(this.key); }
}, Paths: { document: '/private' } }));
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-unlocked', getItemAsync: async (key: string) => state.keys.get(key) ?? null, setItemAsync: async (key: string, value: string) => { state.keys.set(key, value); } }));
vi.mock('expo-crypto', async () => {
  // Exercise the adapter's ciphertext/key handling with real AES-GCM. This
  // substitutes the native transport; it does not certify Expo's native API.
  const crypto = await import('node:crypto');
  const key = (bytes: Buffer) => ({ bytes, encoded: async () => bytes.toString('hex') });
  return {
    AESEncryptionKey: { generate: async () => key(crypto.randomBytes(32)), import: async (hex: string) => key(Buffer.from(hex, 'hex')) },
    AESSealedData: { fromCombined: (bytes: Uint8Array) => ({ bytes }) },
    aesEncryptAsync: async (plain: Uint8Array, encryptionKey: { bytes: Buffer }) => {
      const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey.bytes, iv);
      const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
      return { combined: async () => Buffer.concat([iv, cipher.getAuthTag(), ciphertext]) };
    },
    aesDecryptAsync: async (sealed: { bytes: Uint8Array }, encryptionKey: { bytes: Buffer }) => {
      const bytes = Buffer.from(sealed.bytes); const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey.bytes, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
    },
  };
});
vi.mock('./endpoints', () => ({ messagingApi: { uploadAttachment: state.upload } }));
vi.mock('./tokenStorage', () => ({ getStoredSession: async () => state.session }));
const ownerA = { userId: 'user-a', businessId: 'business-a' };
const ownerB = { userId: 'user-b', businessId: 'business-b' };
const file = { fileName: 'private-invoice.pdf', mimeType: 'application/pdf', dataBase64: 'cHJpdmF0ZS1jdXN0b21lcg==' };

describe('attachment queue ownership', () => {
  beforeEach(() => {
    vi.resetModules();
    state.os = 'web'; state.files.clear(); state.keys.clear();
    state.upload.mockClear();
    state.session = { accessToken: 'access-a', refreshToken: 'refresh-a', ownerUserId: 'user-a', ownerBusinessId: 'business-a' };
  });
  it('does not expose the previous account’s pending attachments after switching accounts', async () => {
    const queue = await import('./messagingAttachmentQueue');
    await queue.enqueueAttachment(file, ownerA);
    state.session = { accessToken: 'access-b', refreshToken: 'refresh-b', ownerUserId: 'user-b', ownerBusinessId: 'business-b' };
    expect(await queue.queuedAttachments(ownerB)).toEqual([]);
  });
  it('does not upload the previous account’s attachment using the new account', async () => {
    const queue = await import('./messagingAttachmentQueue');
    await queue.enqueueAttachment(file, ownerA);
    state.session = { accessToken: 'access-b', refreshToken: 'refresh-b', ownerUserId: 'user-b', ownerBusinessId: 'business-b' };
    await queue.flushAttachmentQueue(undefined, ownerB);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it('persists native attachments encrypted and reads them after a module restart', async () => {
    state.os = 'android';
    let queue = await import('./messagingAttachmentQueue');
    await queue.enqueueAttachment(file, ownerA);
    const persisted = [...state.files.values()][0];
    expect(Buffer.from(persisted).toString()).not.toContain(file.dataBase64);
    expect(Buffer.from(persisted).toString()).not.toContain(file.fileName);
    vi.resetModules(); queue = await import('./messagingAttachmentQueue');
    expect(await queue.queuedAttachments(ownerA)).toMatchObject([file]);
  });
  it('rejects ciphertext copied from another account and does not upload it', async () => {
    state.os = 'android';
    const queue = await import('./messagingAttachmentQueue');
    await queue.enqueueAttachment(file, ownerA);
    const alice = state.files.get('attachment-queue-v2-user-a.business-a.enc')!;
    state.session = { accessToken: 'access-b', refreshToken: 'refresh-b', ownerUserId: 'user-b', ownerBusinessId: 'business-b' };
    await queue.enqueueAttachment({ ...file, fileName: 'b.pdf' }, ownerB);
    state.files.set('attachment-queue-v2-user-b.business-b.enc', alice);
    await expect(queue.flushAttachmentQueue(undefined, ownerB)).rejects.toThrow();
    expect(state.upload).not.toHaveBeenCalled();
  });
  it('drops the cached payload once the server accepts the upload', async () => {
    const queue = await import('./messagingAttachmentQueue');
    await queue.enqueueAttachment(file, ownerA);
    expect(await queue.flushAttachmentQueue(undefined, ownerA)).toMatchObject([{ status: 'QUEUED_FOR_SCAN', dataBase64: '' }]);
    expect(await queue.queuedAttachments(ownerA)).toMatchObject([{ dataBase64: '' }]);
    expect(state.upload).toHaveBeenCalledWith(expect.objectContaining(file), 'access-a');
  });
  it('quarantines legacy unowned data encrypted without assigning it to the next account', async () => {
    state.os = 'android';
    const legacy = new TextEncoder().encode(JSON.stringify([file]));
    state.files.set('messaging-attachment-queue.json', legacy);
    const queue = await import('./messagingAttachmentQueue');
    expect(await queue.queuedAttachments(ownerA)).toEqual([]);
    expect(state.files.has('messaging-attachment-queue.json')).toBe(false);
    const saved = state.files.get('attachment-queue-legacy-quarantine.enc')!;
    expect(Buffer.from(saved).toString()).not.toContain(file.fileName);
    const crypto = await import('expo-crypto');
    const decoded = await crypto.aesDecryptAsync(crypto.AESSealedData.fromCombined(saved), await crypto.AESEncryptionKey.import(state.keys.get('chakusa.attachments.v2.legacy-quarantine')!, 'hex'));
    expect(new Uint8Array(decoded)).toEqual(legacy);
  });
});
