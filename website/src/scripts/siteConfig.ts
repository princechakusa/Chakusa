// Runtime site content from the API's public /app-config (edited in Admin →
// Settings → App configuration), so the website needs no rebuild when the
// copyright line, company details, social links, or notice change.
// Progressive enhancement: the static HTML is the fallback, and the year
// range is computed in the browser even when the API is unreachable.

const API_URL = (import.meta.env.PUBLIC_API_URL as string | undefined) ?? "https://chakusa-api.onrender.com";
const CACHE_KEY = "chakusa.siteConfig.v1";
const CACHE_MS = 10 * 60 * 1000;

interface SiteConfig {
  company?: { legalName?: string | null; registrationNumber?: string | null; address?: string | null; copyrightHolder?: string; copyrightStartYear?: number; websiteUrl?: string };
  social?: { whatsappNumber?: string | null; instagramUrl?: string | null; facebookUrl?: string | null; tiktokUrl?: string | null; linkedinUrl?: string | null };
  app?: { notice?: string | null; maintenance?: boolean };
}

const ICONS: Record<string, string> = {
  whatsapp: "M4 20l1.3-3.9A8 8 0 1 1 8 18.7L4 20Zm5-11c0 3.3 2.7 6 6 6l1-1.5-2-1-1 .8a4.5 4.5 0 0 1-2.3-2.3l.8-1-1-2L9 9Z",
  instagram: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm5.5-2.5h.01",
  facebook: "M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v7h4v-7h3l1-4h-4V8Z",
  tiktok: "M14 3v11a3 3 0 1 1-3-3V7a7 7 0 1 0 7 7V9a6 6 0 0 0 3 1V6a4 4 0 0 1-4-3h-3Z",
  linkedin: "M4 9h4v11H4V9Zm2-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm4 6h4v1.6c.6-1 1.9-1.9 3.6-1.9 3 0 3.4 2 3.4 4.6V20h-4v-5.6c0-1.3 0-2.9-1.8-2.9S13 13 13 14.3V20h-3V9Z",
};

function safeHttps(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const u = new URL(value); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}

function renderCopyright(cfg: SiteConfig | null) {
  const now = new Date().getFullYear();
  document.querySelectorAll<HTMLElement>("[data-cfg-copyright]").forEach((el) => {
    const start = Number(cfg?.company?.copyrightStartYear ?? el.dataset.startYear ?? now) || now;
    const holder = cfg?.company?.copyrightHolder || el.dataset.holder || "Chakusa";
    const years = start >= now ? String(now) : `${start}–${now}`;
    el.textContent = `© ${years} ${holder}. All rights reserved.`;
  });
}

function render(cfg: SiteConfig | null) {
  renderCopyright(cfg);
  if (!cfg) return;
  const c = cfg.company ?? {};
  const details = [c.legalName, c.registrationNumber ? `Reg. no. ${c.registrationNumber}` : null, c.address].filter(Boolean).join(" · ");
  document.querySelectorAll<HTMLElement>("[data-cfg-company]").forEach((el) => { el.textContent = details; el.hidden = !details; });

  const s = cfg.social ?? {};
  const links: [string, string, string | null][] = [
    ["whatsapp", "WhatsApp", s.whatsappNumber && /^\+\d{8,15}$/.test(s.whatsappNumber) ? `https://wa.me/${s.whatsappNumber.slice(1)}` : null],
    ["instagram", "Instagram", safeHttps(s.instagramUrl)],
    ["facebook", "Facebook", safeHttps(s.facebookUrl)],
    ["tiktok", "TikTok", safeHttps(s.tiktokUrl)],
    ["linkedin", "LinkedIn", safeHttps(s.linkedinUrl)],
  ];
  document.querySelectorAll<HTMLElement>("[data-cfg-social]").forEach((nav) => {
    nav.replaceChildren();
    for (const [key, label, href] of links) {
      if (!href) continue;
      const a = document.createElement("a");
      a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.setAttribute("aria-label", label);
      a.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[key]}"/></svg>`;
      nav.append(a);
    }
    nav.hidden = nav.childElementCount === 0;
  });

  const notice = cfg.app?.maintenance ? (cfg.app.notice || "Chakusa is undergoing maintenance. Some features may be briefly unavailable.") : cfg.app?.notice;
  let bar = document.querySelector<HTMLElement>("[data-site-notice]");
  if (notice) {
    if (!bar) { bar = document.createElement("div"); bar.dataset.siteNotice = ""; bar.setAttribute("role", "status"); document.body.prepend(bar); }
    bar.className = `site-notice${cfg.app?.maintenance ? " site-notice--warn" : ""}`;
    bar.textContent = notice;
  } else bar?.remove();
}

function readCache(): SiteConfig | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw) as { at: number; data: SiteConfig };
    return Date.now() - at < CACHE_MS ? data : null;
  } catch { return null; }
}

async function load() {
  const cached = readCache();
  render(cached);
  if (cached) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_URL}/app-config`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = (await res.json()) as SiteConfig & { schemaVersion?: number };
    if (data.schemaVersion !== 1) return;
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* private mode */ }
    render(data);
  } catch { /* offline: static fallback stays */ }
}

void load();
