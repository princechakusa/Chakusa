import { ApiErrorBody, RefreshResponse } from '../apiTypes';
import { API_URL } from '../config';
import { appIntegrityHeaders } from './appAttestation';
import { renderWakeErrorCopy } from '../domain/mobileProduction';
import { businessSessionRevision, clearStoredSession, getStoredSession, storeSession } from './tokenStorage';

export type ApiErrorKind = 'validation' | 'unauthorized' | 'forbidden' | 'not-found' | 'conflict' | 'server' | 'network' | 'configuration' | 'invalid-response';
const REQUEST_TIMEOUT_MS = 20_000;
const errorKinds: Record<number, ApiErrorKind> = { 400: 'validation', 401: 'unauthorized', 403: 'forbidden', 404: 'not-found', 409: 'conflict', 500: 'server' };

export class ApiError extends Error {
  constructor(public kind: ApiErrorKind, message: string, public status?: number, public code?: string, public details?: unknown) { super(message); }
}

let unauthorizedHandler: (() => void | Promise<void>) | undefined;
let entitlementErrorHandler: ((error: ApiError) => void) | undefined;
let refreshPromise: Promise<string> | null = null;
let refreshRevision = -1;
function assertSession(revision: number) {
  if (revision !== businessSessionRevision()) throw new ApiError('unauthorized', 'Your session changed. Please retry.', 401, 'AUTH_SESSION_CHANGED');
}
export function setUnauthorizedHandler(handler?: () => void | Promise<void>) { unauthorizedHandler = handler; }
export function setEntitlementErrorHandler(handler?: (error: ApiError) => void) { entitlementErrorHandler = handler; }

async function parseError(response: Response) {
  try { return await response.json() as ApiErrorBody; } catch { return null; }
}

function errorMessage(body: ApiErrorBody | null) {
  if (!body) return 'Something went wrong. Please try again.';
  const details = body.error.details;
  if (body.error.code === 'VALIDATION_ERROR' && details && typeof details === 'object' && 'fieldErrors' in details) {
    const fieldErrors = (details as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    const first = fieldErrors && Object.entries(fieldErrors).find(([, messages]) => messages.length > 0);
    if (first) return `${first[0]}: ${first[1][0]}`;
  }
  return body.error.message;
}

async function responseError(response: Response) {
  const body = await parseError(response);
  const code = body?.error.code;
  const message = code === 'LIMIT_REACHED' ? `You've reached your current plan limit.` : ['FEATURE_NOT_AVAILABLE', 'PLAN_REQUIRED'].includes(code ?? '') ? 'This feature requires Chakusa Pro.' : errorMessage(body);
  return new ApiError(errorKinds[response.status] ?? 'server', message, response.status, code, body?.error.details);
}

async function rotateSession(signal?: AbortSignal | null): Promise<string> {
  const revision = businessSessionRevision();
  if (refreshPromise && refreshRevision === revision) return refreshPromise;
  const pending = (async () => {
    if (!API_URL) throw new ApiError('configuration', 'Chakusa is not configured with an API address. Set EXPO_PUBLIC_API_URL and rebuild this app.', undefined, 'API_URL_MISSING');
    const session = await getStoredSession();
    assertSession(revision);
    if (!session) throw new ApiError('unauthorized', 'Your session has expired.', 401, 'AUTH_SESSION_EXPIRED');
    let response: Response;
    try {
      response = await fetchWithTimeout(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
        signal,
      });
    } catch (caught) {
      if (caught instanceof ApiError) throw caught;
      throw new ApiError('network', 'Unable to reach CHAKUSA. Check your connection and try again.');
    }
    if (!response.ok) {
      const error = await responseError(response);
      assertSession(revision);
      if (response.status === 401) {
        await clearStoredSession();
        await unauthorizedHandler?.();
      }
      throw error;
    }
    const next = await response.json() as RefreshResponse;
    assertSession(revision);
    if (typeof next.accessToken !== 'string' || !next.accessToken || typeof next.refreshToken !== 'string' || !next.refreshToken) throw new ApiError('unauthorized', 'Invalid session response.', 401, 'AUTH_TOKEN_INVALID');
    await storeSession({ ...session, accessToken: next.accessToken, refreshToken: next.refreshToken }, revision);
    return next.accessToken;
  })().finally(() => { if (refreshPromise === pending) refreshPromise = null; });
  refreshRevision = revision;
  refreshPromise = pending;
  return pending;
}

interface ApiRequestInit extends RequestInit { auth?: 'required' | 'none'; retryRefresh?: boolean; expectedAccessToken?: string; }

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  try { return await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(await appIntegrityHeaders(url)) }, signal: controller.signal }); }
  catch (caught) { if (caught instanceof Error && caught.name === 'AbortError') throw new ApiError('network', renderWakeErrorCopy('REQUEST_TIMEOUT'), undefined, 'REQUEST_TIMEOUT'); throw caught; }
  finally { clearTimeout(timeout); init.signal?.removeEventListener('abort', abort); }
}

export class ApiClient {
  async request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const { auth = 'required', retryRefresh = true, expectedAccessToken, ...requestInit } = init;
    const revision = businessSessionRevision();
    if (!API_URL) throw new ApiError('configuration', 'Chakusa is not configured with an API address. Set EXPO_PUBLIC_API_URL and rebuild this app.', undefined, 'API_URL_MISSING');
    const session = auth === 'required' ? await getStoredSession() : null;
    assertSession(revision);
    if (expectedAccessToken !== undefined && session?.accessToken !== expectedAccessToken) throw new ApiError('unauthorized', 'Your session changed. Please retry.', 401, 'AUTH_SESSION_CHANGED');
    let response: Response;
    try {
      response = await fetchWithTimeout(`${API_URL}${path}`, {
        ...requestInit,
        headers: {
          Accept: 'application/json',
          // Only when there is a body: the API rejects an empty JSON body, which
          // broke every bodyless DELETE (e.g. stop sharing location, remove blocked time).
          ...(requestInit.body != null ? { 'Content-Type': 'application/json' } : {}),
          ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
          ...requestInit.headers,
        },
      });
    } catch (caught) {
      if (caught instanceof ApiError) throw caught;
      throw new ApiError('network', 'Unable to reach CHAKUSA. Check your connection and try again.');
    }

    assertSession(revision);
    if (response.status === 401 && auth === 'required' && retryRefresh) {
      const accessToken = await rotateSession(requestInit.signal);
      return this.request<T>(path, {
        ...requestInit,
        auth: 'required',
        retryRefresh: false,
        expectedAccessToken: accessToken,
        headers: { ...requestInit.headers, Authorization: `Bearer ${accessToken}` },
      });
    }
    if (response.status === 401 && auth === 'required') {
      await clearStoredSession();
      await unauthorizedHandler?.();
    }
    if (!response.ok) {
      const error = await responseError(response);
      assertSession(revision);
      if (['LIMIT_REACHED', 'FEATURE_NOT_AVAILABLE', 'PLAN_REQUIRED'].includes(error.code ?? '')) entitlementErrorHandler?.(error);
      throw error;
    }
    if (response.status === 204) return undefined as T;
    let body: T;
    try { body = await response.json() as T; } catch { throw new ApiError('invalid-response', 'The server returned an unexpected response.'); }
    assertSession(revision);
    return body;
  }
  get<T>(path: string, auth: 'required' | 'none' = 'required') { return this.request<T>(path, { auth }); }
  post<T>(path: string, body: unknown = {}, auth: 'required' | 'none' = 'required') { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body), auth }); }
  patch<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); }
  put<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) }); }
  delete<T>(path: string) { return this.request<T>(path, { method: 'DELETE' }); }
}

export const api = new ApiClient();
