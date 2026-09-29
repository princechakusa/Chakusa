// Shared client helpers for dashboard pages.
//
// Every request goes to the auth gateway's named allowlist routes with the
// HttpOnly session cookie; the backend re-checks session, tenancy,
// capability and entitlement on every call. Nothing here grants access.
// All rendering helpers build DOM nodes with textContent — never HTML — so
// server data can't inject markup.
export { isUuid } from "./salesDocuments.js";

export const GATEWAY = "https://auth.chakusarecovery.com";

export class AuthRequired extends Error {}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${GATEWAY}${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new AuthRequired();
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "That could not be completed. Please try again.");
  return payload as T;
}

export interface Identity { realm: string | null; role: string | null; business: any; account: any }

export async function loadIdentity(): Promise<Identity> {
  const data = await api("/v1/dashboard");
  return {
    realm: typeof data?.realm === "string" ? data.realm : null,
    role: typeof data?.account?.role === "string" ? data.account.role : null,
    business: data?.business ?? null,
    account: data?.account ?? null,
  };
}

export const itemsOf = (payload: any): any[] =>
  Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.members) ? payload.members : [];

export function money(value: unknown, currency: unknown = "USD"): string {
  const amount = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(amount)) return "—";
  const code = typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(amount); } catch { return amount.toFixed(2); }
}

export const label = (value: unknown) => String(value ?? "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export function dateTime(value: unknown, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? "" : date.toLocaleString(undefined, options);
}

/** Creates an element whose text is set via textContent (never innerHTML). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, options: { className?: string; text?: string; attrs?: Record<string, string> } = {}, ...children: (Node | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [key, value] of Object.entries(options.attrs ?? {})) node.setAttribute(key, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Standard page states: loading → content, or sign-in / error message. */
export function pageStates(prefix = "page") {
  const find = (name: string) => document.querySelector<HTMLElement>(`[data-${prefix}-${name}]`);
  return {
    ready() { find("loading")!.hidden = true; find("content")!.hidden = false; },
    fail(error: unknown) {
      find("loading")!.hidden = true;
      find("content")!.hidden = true;
      if (error instanceof AuthRequired) { find("auth")!.hidden = false; return; }
      const box = find("error")!;
      const text = box.querySelector("p");
      if (text) text.textContent = error instanceof Error ? error.message : "This page is temporarily unavailable.";
      box.hidden = false;
    },
  };
}
