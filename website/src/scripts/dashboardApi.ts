// Shared client helpers for dashboard pages.
//
// Every request goes to the auth gateway's named allowlist routes with the
// HttpOnly session cookie (sessionGate.ts serialises session renewal); the
// backend re-checks session, tenancy, capability and entitlement on every
// call. Nothing here grants access. Rendering helpers build DOM nodes with
// textContent - never HTML - so server data can't inject markup.
export { isUuid } from "./salesDocuments.js";

export const GATEWAY = "https://auth.chakusarecovery.com";

/** A failed gateway call, typed so pages can show the right state. */
export class ApiFailure extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly requiredPlan?: "PRO" | "BUSINESS", readonly feature?: string) { super(message); }
}
/** 401: the session is missing or expired. */
export class AuthRequired extends ApiFailure { constructor() { super("Your session has expired.", 401); } }
/** 403 FEATURE_NOT_AVAILABLE: the business's plan doesn't include this. */
export class FeatureLocked extends ApiFailure {}
/** 403: the member's role can't do this. */
export class AccessDenied extends ApiFailure {}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${GATEWAY}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiFailure("We couldn't reach Chakusa. Check your connection and try again.", 0);
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new AuthRequired();
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "That could not be completed. Please try again.";
    const plan = payload?.requiredPlan === "PRO" || payload?.requiredPlan === "BUSINESS" ? payload.requiredPlan : undefined;
    if (response.status === 403 && payload?.code === "FEATURE_NOT_AVAILABLE") throw new FeatureLocked(message, 403, payload.code, plan ?? "BUSINESS", payload.feature);
    if (response.status === 403) throw new AccessDenied(message, 403, payload?.code);
    throw new ApiFailure(message, response.status, payload?.code);
  }
  return payload as T;
}

export interface Identity { realm: string | null; role: string | null; business: any; account: any; dashboard: any; legal: any }

let identityPromise: Promise<Identity> | null = null;
/** The signed-in member (fetched once per page, shared by every script). */
export function loadIdentity(): Promise<Identity> {
  identityPromise ??= api("/v1/dashboard").then((data) => ({
    realm: typeof data?.realm === "string" ? data.realm : null,
    role: typeof data?.account?.role === "string" ? data.account.role : null,
    business: data?.business ?? null,
    account: data?.account ?? null,
    dashboard: data?.dashboard ?? null,
    legal: data?.legal ?? null,
  })).catch((error) => { identityPromise = null; throw error; });
  return identityPromise;
}

let planPromise: Promise<any> | null = null;
/** The business's plan and feature flags (read-only; fetched once per page). */
export function loadPlan(): Promise<any> {
  planPromise ??= api("/v1/business/subscription").catch(() => null);
  return planPromise;
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

/** "3 min ago", "yesterday", or a date. */
export function relativeTime(value: unknown): string {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.valueOf())) return "";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return format.format(-seconds, "second");
  if (Math.abs(seconds) < 3600) return format.format(-Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86_400) return format.format(-Math.round(seconds / 3600), "hour");
  if (Math.abs(seconds) < 7 * 86_400) return format.format(-Math.round(seconds / 86_400), "day");
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
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

/** What each plan-gated feature is, for the "locked" state. */
export const FEATURES: Record<string, { name: string; pitch: string; benefits: string[] }> = {
  INVOICING: { name: "Invoicing", pitch: "Send professional invoices and get paid online.", benefits: ["Create and send invoices in seconds", "Customers pay securely by card through Stripe", "Track paid, outstanding and overdue at a glance"] },
  QUOTES_ESTIMATES: { name: "Quotes & estimates", pitch: "Win jobs with clear, professional quotes.", benefits: ["Line-item quotes and estimates", "Customers accept online with one link", "Turn an accepted quote into an invoice instantly"] },
  INVENTORY: { name: "Inventory", pitch: "Know what's in stock before you run out.", benefits: ["Track products and supplies", "Record stock received and used", "Low-stock alerts"] },
  AI_RECEPTIONIST: { name: "AI Receptionist", pitch: "Answer customer messages around the clock.", benefits: ["Replies to SMS and WhatsApp for you", "After-hours only, or always on", "You stay in control of what it can do"] },
  AUTOMATION: { name: "Automations", pitch: "Follow-ups that run themselves.", benefits: ["Automatic reminders and review requests", "Win back customers who haven't returned", "Runs quietly in the background"] },
  OUTBOUND_MESSAGING: { name: "SMS & WhatsApp messaging", pitch: "Message customers straight from Chakusa.", benefits: ["Two-way SMS and WhatsApp inbox", "Booking confirmations and reminders", "Every conversation in one place"] },
  TEAM_MANAGEMENT: { name: "Team management", pitch: "Bring your team into Chakusa.", benefits: ["Invite staff and admins", "Role-based access to every area", "Commission tracking per team member"] },
  FINANCIAL_MANAGEMENT: { name: "Financial management", pitch: "See where your money goes.", benefits: ["Income and expense tracking", "Profit summaries", "Export for your accountant"] },
};

/** Page states: loading → content, or a specific state for each failure. */
export function pageStates(prefix = "page") {
  const find = (name: string) => document.querySelector<HTMLElement>(`[data-${prefix}-${name}]`);
  const hideAll = () => { for (const name of ["loading", "content", "auth", "error", "locked", "denied"]) { const node = find(name); if (node) node.hidden = true; } };
  const api = {
    ready() { hideAll(); find("content")!.hidden = false; },
    fail(error: unknown, retry?: () => void) {
      hideAll();
      if (error instanceof AuthRequired) { find("auth")!.hidden = false; return; }
      if (error instanceof FeatureLocked && find("locked")) {
        const box = find("locked")!;
        const info = FEATURES[error.feature ?? ""] ?? { name: "This feature", pitch: error.message, benefits: [] };
        const planName = error.requiredPlan === "PRO" ? "Pro" : "Business";
        box.querySelector("[data-locked-title]")!.textContent = `${info.name} is part of the ${planName} plan`;
        box.querySelector("[data-locked-pitch]")!.textContent = info.pitch;
        const list = box.querySelector("[data-locked-benefits]")!;
        list.replaceChildren(...info.benefits.map((benefit) => el("li", { text: benefit })));
        box.hidden = false;
        return;
      }
      if (error instanceof AccessDenied && find("denied")) {
        find("denied")!.querySelector("p")!.textContent = "Your role doesn't include this area. Ask the business owner if you need access.";
        find("denied")!.hidden = false;
        return;
      }
      const box = find("error")!;
      const text = box.querySelector("p");
      if (text) text.textContent = error instanceof Error ? error.message : "This page is temporarily unavailable.";
      const button = box.querySelector<HTMLButtonElement>("[data-retry]");
      if (button) { button.hidden = !retry; button.onclick = retry ? () => { hideAll(); find("loading")!.hidden = false; retry(); } : null; }
      box.hidden = false;
    },
  };
  return api;
}
