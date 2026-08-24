const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:4000";

let accessToken: string | null = null;
let csrfToken: string | null = sessionStorage.getItem("chakusa_admin_csrf");
let refreshPromise: Promise<boolean> | null = null;
const unauthorizedListeners = new Set<() => void>();

export interface ApiErrorShape { error?: { code?: string; message?: string; details?: unknown } }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function setAdminSession(nextAccessToken: string | null, nextCsrfToken?: string | null) {
  accessToken = nextAccessToken;
  if (nextCsrfToken !== undefined) {
    csrfToken = nextCsrfToken;
    if (nextCsrfToken) sessionStorage.setItem("chakusa_admin_csrf", nextCsrfToken);
    else sessionStorage.removeItem("chakusa_admin_csrf");
  }
}

export function onUnauthorized(listener: () => void) {
  unauthorizedListeners.add(listener);
  return () => { unauthorizedListeners.delete(listener); };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  const body = await response.json().catch(() => ({})) as ApiErrorShape;
  throw new ApiError(response.status, body.error?.code ?? "REQUEST_FAILED", body.error?.message ?? "Request failed", body.error?.details);
}

export async function refreshAdminSession(): Promise<boolean> {
  if (!csrfToken) return false;
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch(`${API_URL}/admin/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "x-csrf-token": csrfToken },
  })
    .then(async (response) => {
      if (!response.ok) return false;
      const body = await response.json() as { accessToken: string; csrfToken: string };
      setAdminSession(body.accessToken, body.csrfToken);
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) headers.set("x-csrf-token", csrfToken);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
  if (response.status === 401 && retry && await refreshAdminSession()) return apiFetch<T>(path, init, false);
  if (response.status === 401) {
    setAdminSession(null, null);
    unauthorizedListeners.forEach((listener) => listener());
  }
  return parseResponse<T>(response);
}

export async function loginAdmin(email: string, password: string) {
  const body = await parseResponse<{
    accessToken: string;
    csrfToken: string;
    user: AdminUser;
    admin: AdminIdentity;
  }>(await fetch(`${API_URL}/admin/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }));
  setAdminSession(body.accessToken, body.csrfToken);
  return body;
}

export async function logoutAdmin() {
  try {
    if (csrfToken) await fetch(`${API_URL}/admin/auth/logout`, { method: "POST", credentials: "include", headers: { "x-csrf-token": csrfToken } });
  } finally {
    setAdminSession(null, null);
  }
}

export interface AdminUser { id: string; email: string; fullName: string }
export interface AdminIdentity { id: string; role: string; permissions: string[] }
export interface PageEnvelope<T> { items: T[]; total: number; page: number; pageSize: number }

export function queryString(values: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") search.set(key, String(value));
  return search.toString();
}
