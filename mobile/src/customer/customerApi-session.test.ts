import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-secure-store', () => ({}));
vi.mock('../config', () => ({ API_URL: 'https://api.example' }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status }); }
const a = { accessToken: 'customer-a', refreshToken: 'refresh-a' };
const b = { accessToken: 'customer-b', refreshToken: 'refresh-b' };

describe('customer API session boundaries', () => {
  beforeEach(() => {
    vi.resetModules();
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  });
  it('cancels a stalled customer restore while preserving its saved credentials', async () => {
    const store = await import('./session'); const { customerHttp } = await import('./customerApi');
    await store.storeCustomerSession(a);
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
    })); vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const result = customerHttp.get('/customer/auth/me', 'required', controller.signal).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); controller.abort();
    expect(await result).toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(await store.getCustomerSession()).toEqual(a);
  });
  it('does not restore a customer session after logout while refresh was pending', async () => {
    const store = await import('./session'); const { customerHttp } = await import('./customerApi');
    await store.storeCustomerSession(a);
    const refresh = deferred<Response>();
    const fetcher = vi.fn().mockResolvedValueOnce(response(401, {})).mockImplementationOnce(() => refresh.promise);
    vi.stubGlobal('fetch', fetcher);
    const result = customerHttp.get('/customer/private').catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await store.clearCustomerSession();
    refresh.resolve(response(200, { accessToken: 'late-a', refreshToken: 'late-refresh-a' }));
    expect(await result).toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
    expect(await store.getCustomerSession()).toBeNull();
  });
  it('does not clear a new customer session on an old unauthorized response', async () => {
    const store = await import('./session'); const { customerHttp } = await import('./customerApi');
    await store.storeCustomerSession(a);
    const pending = deferred<Response>(); const fetcher = vi.fn(() => pending.promise); vi.stubGlobal('fetch', fetcher);
    const result = customerHttp.get('/customer/private').catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await store.storeCustomerSession(b); pending.resolve(response(401, {}));
    expect(await result).toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
    expect(await store.getCustomerSession()).toEqual(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('discards customer content when the session changes during body parsing', async () => {
    const store = await import('./session'); const { customerHttp } = await import('./customerApi');
    await store.storeCustomerSession(a);
    const body = deferred<unknown>(); const json = vi.fn(() => body.promise);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json })));
    const result = customerHttp.get('/customer/private').catch(error => error);
    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    await store.storeCustomerSession(b); body.resolve({ privateCustomerData: 'account-a' });
    expect(await result).toMatchObject({ code: 'AUTH_SESSION_CHANGED' });
  });
  it('refreshes a valid customer session and leaves business tokens untouched', async () => {
    const store = await import('./session'); const business = await import('../services/tokenStorage');
    const { customerHttp } = await import('./customerApi');
    await store.storeCustomerSession(a); await business.storeSession({ accessToken: 'business', refreshToken: 'business-refresh' });
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/customer/auth/refresh')) return response(200, { accessToken: 'rotated', refreshToken: 'rotated-refresh' });
      return new Headers(init.headers).get('authorization') === 'Bearer rotated' ? response(200, { ok: true }) : response(401, {});
    }); vi.stubGlobal('fetch', fetcher);
    expect(await customerHttp.get('/customer/private')).toEqual({ ok: true });
    expect(await business.getStoredSession()).toMatchObject({ accessToken: 'business', refreshToken: 'business-refresh' });
  });
});
