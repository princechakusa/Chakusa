import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-secure-store', () => ({}));
vi.mock('../config', () => ({ API_URL: 'https://api.example' }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const sessionA = { accessToken: 'access-a', refreshToken: 'refresh-a', ownerUserId: 'user-a', ownerBusinessId: 'business-a' };
const sessionB = { accessToken: 'access-b', refreshToken: 'refresh-b', ownerUserId: 'user-b', ownerBusinessId: 'business-b' };
function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }

describe('business API session boundaries', () => {
  beforeEach(() => {
    vi.resetModules();
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  });
  it('cancels a stalled startup request without deleting the saved session', async () => {
    const storage = await import('./tokenStorage'); const { api } = await import('./api');
    await storage.storeSession(sessionA);
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
    })); vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const result = api.request('/auth/me', { signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await result).toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(await storage.getStoredSession()).toEqual(sessionA);
  });
  it('does not resurrect a session when refresh finishes after logout', async () => {
    const storage = await import('./tokenStorage');
    const { api } = await import('./api');
    await storage.storeSession(sessionA);
    const refresh = deferred<Response>();
    const fetcher = vi.fn().mockResolvedValueOnce(response(401, {})).mockImplementationOnce(() => refresh.promise);
    vi.stubGlobal('fetch', fetcher);
    const result = api.get('/private').catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await storage.clearStoredSession();
    refresh.resolve(response(200, { accessToken: 'rotated-a', refreshToken: 'rotated-refresh-a' }));
    expect(await result).toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
    expect(await storage.getStoredSession()).toBeNull();
  });
  it('does not clear a new account because an old request returns 401', async () => {
    const storage = await import('./tokenStorage');
    const { api } = await import('./api');
    await storage.storeSession(sessionA);
    const pending = deferred<Response>();
    const fetcher = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetcher);
    const result = api.get('/private').catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await storage.storeSession(sessionB);
    pending.resolve(response(401, {}));
    expect(await result).toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
    expect(await storage.getStoredSession()).toEqual(sessionB);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('discards a previous account’s response when account changes during JSON parsing', async () => {
    const storage = await import('./tokenStorage');
    const { api } = await import('./api');
    await storage.storeSession(sessionA);
    const body = deferred<unknown>();
    const json = vi.fn(() => body.promise);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json })));
    const result = api.get('/private').catch(error => error);
    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    await storage.storeSession(sessionB);
    body.resolve({ customerName: 'Private previous account' });
    expect(await result).toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
  });
  it('refreshes concurrent requests once and preserves attachment ownership', async () => {
    const storage = await import('./tokenStorage');
    const { api } = await import('./api');
    await storage.storeSession(sessionA);
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return response(200, { accessToken: 'rotated-a', refreshToken: 'rotated-refresh-a' });
      return new Headers(init.headers).get('authorization') === 'Bearer rotated-a' ? response(200, { ok: true }) : response(401, {});
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await Promise.all([api.get('/private'), api.get('/other')])).toEqual([{ ok: true }, { ok: true }]);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(await storage.getStoredSession()).toEqual({ ...sessionA, accessToken: 'rotated-a', refreshToken: 'rotated-refresh-a' });
  });
  it('rejects an attachment request bound to a different session before transmitting', async () => {
    const storage = await import('./tokenStorage');
    const { api } = await import('./api');
    await storage.storeSession(sessionB);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(api.request('/messages/attachments/mobile', { method: 'POST', body: 'private-a', expectedAccessToken: sessionA.accessToken })).rejects.toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
