// Dev helper: screenshots dashboard pages against the local build with a
// fixture gateway. Usage: node e2e/screens.mjs <outDir>  (astro preview on :4321)
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "screens";
const G = "https://auth.chakusarecovery.com";
const now = new Date();
const iso = (d, h) => { const x = new Date(now); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
const U = (n) => `${String(n).padStart(8, "0")}-1111-4222-8333-444444444444`;
const plan = process.env.PLAN ?? "FREE";
const locked = { code: "FEATURE_NOT_AVAILABLE", error: "Invoicing is available on the Business plan", requiredPlan: "BUSINESS", feature: "INVOICING" };
const fixtures = {
  "GET /v1/session": { realm: "business", refreshed: false, expiresIn: 800 },
  "GET /v1/dashboard": { realm: "business", account: { role: "OWNER", user: { id: U(1), email: "owner@example.com", fullName: "Olivia Owner", hasPassword: true } }, business: { name: "Fade & Co Barbers", currency: "USD", onboardingCompletedAt: null, phone: "+1 555 0100", workingHours: { version: 1 }, googleReviewLink: null }, dashboard: { businessHealth: { score: 72 }, leads: { total: 14, new: 3, conversionRate: 0.42 }, customerIntelligence: { totalCustomers: 86 }, recoveredRevenue: { total: 1240, outstanding: 320, appointmentOutstanding: 0, appointmentCollected: 860 }, customersDue: 5, activation: { activePublicServices: 3, appointmentsBooked: 12 }, recommendations: [{ key: "a", message: "5 customers are due for a return visit. Send them a come-back reminder.", severity: "medium" }, { key: "b", message: "Ask Jordan Lee for a review: they visited yesterday.", severity: "info" }], recentActivity: [{ eventType: "APPOINTMENT_CREATED", createdAt: iso(0, 9) }, { eventType: "LEAD_WON", createdAt: iso(-1, 15) }, { eventType: "CUSTOMER_CREATED", createdAt: iso(-2, 11) }] }, legal: { pending: [] } },
  "GET /v1/business/attention": { total: 2, items: [{ category: "payment_outstanding", id: U(2), customerId: U(3), customerName: "Jordan Lee", detail: "Invoice INV-12", occurredAt: iso(-2, 10), amount: 45 }, { category: "customer_due", id: U(4), customerId: U(5), customerName: "Sam Rivers", detail: "Last visit 6 weeks ago", occurredAt: iso(-1, 10), amount: null }] },
  "GET /v1/business/subscription": { plan, status: "ACTIVE", features: { invoicing: plan === "BUSINESS", quotesEstimates: plan === "BUSINESS", automation: plan !== "FREE" }, usage: { leads: { current: 14, limit: plan === "FREE" ? 40 : null }, customers: { current: 86, limit: plan === "FREE" ? 100 : null } } },
  "GET /v1/business/customers": { items: [{ id: U(3), name: "Jordan Lee", phone: "+1 555 0101", createdAt: iso(-30, 9) }, { id: U(5), name: "Sam Rivers", email: "sam@example.com", createdAt: iso(-60, 9) }] },
  "GET /v1/business/appointments": [{ id: U(6), startsAt: iso(0, 10), endsAt: iso(0, 11), status: "CONFIRMED", serviceName: "Skin fade", customer: { id: U(3), name: "Jordan Lee" } }, { id: U(7), startsAt: iso(1, 14), endsAt: iso(1, 15), status: "SCHEDULED", serviceName: "Beard trim", customer: { id: U(5), name: "Sam Rivers" } }],
  "GET /v1/business/invoices": plan === "BUSINESS" ? { items: [] } : [403, locked],
  "GET /v1/business/quotes": plan === "BUSINESS" ? { items: [] } : [403, { ...locked, error: "Quotes & estimates is available on the Business plan", feature: "QUOTES_ESTIMATES" }],
  "GET /v1/business/leads": { items: [] },
  "GET /v1/business/services": [{ id: "x" }],
  "GET /v1/business/calendar-feeds": [],
  "GET /v1/business/payments": { enabled: true, connected: false, chargesEnabled: false, payoutsEnabled: false },
};
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: process.env.MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
await page.route(`${G}/**`, (route) => {
  const u = new URL(route.request().url());
  const f = fixtures[`${route.request().method()} ${u.pathname}`];
  const [status, body] = Array.isArray(f) && typeof f[0] === "number" ? f : [f === undefined ? 404 : 200, f ?? { error: "Not found." }];
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
});
for (const rawPath of (process.env.PAGES ?? "/dashboard/business/,/dashboard/business/invoices/,/dashboard/business/customers/,/dashboard/business/calendar/,/dashboard/business/services/,/dashboard/business/leads/").split(",")) { const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  await page.goto(`http://localhost:4321${path}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${path.replace(/\//g, "_") || "root"}.png`, fullPage: false });
}
await browser.close();
