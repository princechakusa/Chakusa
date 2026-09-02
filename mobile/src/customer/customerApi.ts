import { ApiErrorBody } from '../apiTypes';
import { API_URL } from '../config';
import { ApiError } from '../services/api';
import { renderWakeErrorCopy } from '../domain/mobileProduction';
import { clearCustomerSession, getCustomerSession, storeCustomerSession } from './session';

// PROGRAM 2 LOOP 7: the CUSTOMER API transport. Self-contained and bound
// exclusively to the customer session store + /customer/auth/refresh. It
// never reads or writes the business session. Mirrors the business
// ApiClient's timeout / 401-refresh / ApiError behaviour so error handling
// is identical across the two apps, but keeps the token scope isolated
// (Loop 7 spec §13, §53: token separation over shared code).

const REQUEST_TIMEOUT_MS = 20_000;
const errorKinds: Record<number, ApiError['kind']> = { 400: 'validation', 401: 'unauthorized', 403: 'forbidden', 404: 'not-found', 409: 'conflict', 500: 'server' };

let onUnauthorized: (() => void | Promise<void>) | undefined;
export function setCustomerUnauthorizedHandler(handler?: () => void | Promise<void>) { onUnauthorized = handler; }

async function parseBody(response: Response): Promise<ApiErrorBody | null> {
  try { return (await response.json()) as ApiErrorBody; } catch { return null; }
}

function messageFrom(body: ApiErrorBody | null): string {
  if (!body) return 'Something went wrong. Please try again.';
  const details = body.error.details;
  if (body.error.code === 'VALIDATION_ERROR' && details && typeof details === 'object' && 'fieldErrors' in details) {
    const fieldErrors = (details as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    const first = fieldErrors && Object.entries(fieldErrors).find(([, messages]) => messages.length > 0);
    if (first) return `${first[0]}: ${first[1][0]}`;
  }
  return body.error.message;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = await parseBody(response);
  return new ApiError(errorKinds[response.status] ?? 'server', messageFrom(body), response.status, body?.error.code, body?.error.details);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (caught) {
    if (caught instanceof Error && caught.name === 'AbortError') {
      throw new ApiError('network', renderWakeErrorCopy('REQUEST_TIMEOUT'), undefined, 'REQUEST_TIMEOUT');
    }
    throw caught;
  } finally {
    clearTimeout(timeout);
  }
}

let refreshPromise: Promise<string> | null = null;
async function rotateCustomerSession(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    if (!API_URL) throw new ApiError('configuration', 'Chakusa is not configured with an API address.', undefined, 'API_URL_MISSING');
    const session = await getCustomerSession();
    if (!session) throw new ApiError('unauthorized', 'Your session has expired.', 401, 'AUTH_SESSION_EXPIRED');
    let response: Response;
    try {
      response = await fetchWithTimeout(`${API_URL}/customer/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
    } catch (caught) {
      if (caught instanceof ApiError) throw caught;
      throw new ApiError('network', 'Unable to reach Chakusa. Check your connection and try again.');
    }
    if (!response.ok) {
      const error = await toApiError(response);
      if (response.status === 401) { await clearCustomerSession(); await onUnauthorized?.(); }
      throw error;
    }
    const next = (await response.json()) as { accessToken: string; refreshToken: string };
    await storeCustomerSession({ accessToken: next.accessToken, refreshToken: next.refreshToken });
    return next.accessToken;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

interface CustomerRequestInit extends RequestInit { auth?: 'required' | 'none'; retryRefresh?: boolean }

async function request<T>(path: string, init: CustomerRequestInit = {}): Promise<T> {
  const { auth = 'required', retryRefresh = true, ...requestInit } = init;
  if (!API_URL) throw new ApiError('configuration', 'Chakusa is not configured with an API address. Set EXPO_PUBLIC_API_URL and rebuild this app.', undefined, 'API_URL_MISSING');
  const session = auth === 'required' ? await getCustomerSession() : null;

  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_URL}${path}`, {
      ...requestInit,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        ...requestInit.headers,
      },
    });
  } catch (caught) {
    if (caught instanceof ApiError) throw caught;
    throw new ApiError('network', 'Unable to reach Chakusa. Check your connection and try again.');
  }

  if (response.status === 401 && auth === 'required' && retryRefresh) {
    const accessToken = await rotateCustomerSession();
    return request<T>(path, { ...requestInit, auth: 'required', retryRefresh: false, headers: { ...requestInit.headers, Authorization: `Bearer ${accessToken}` } });
  }
  if (response.status === 401 && auth === 'required') { await clearCustomerSession(); await onUnauthorized?.(); }
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  try { return (await response.json()) as T; } catch { throw new ApiError('invalid-response', 'The server returned an unexpected response.'); }
}

export const customerHttp = {
  get: <T>(path: string, auth: 'required' | 'none' = 'required') => request<T>(path, { auth }),
  post: <T>(path: string, body: unknown = {}, auth: 'required' | 'none' = 'required') => request<T>(path, { method: 'POST', body: JSON.stringify(body), auth }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
