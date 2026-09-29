import { expect, test, type Page, type Route } from "@playwright/test";

// The built site served locally, with the auth gateway answered by fixtures.
// Checks dashboard behaviour plus client-side security properties: requests
// only go to named gateway routes, server data is never rendered as HTML,
// money/links are handled safely, and role gating matches the backend matrix.

const GATEWAY = "https://auth.chakusarecovery.com";
const UUID = (n: number) => `${String(n).padStart(8, "0")}-1111-4222-8333-444444444444`;
const XSS = `<img src=x onerror="window.__xss=1">Evil`;

type Handler = (body: any, url: URL) => [number, unknown] | unknown;
interface Mock { calls: { method: string; path: string; body: any }[] }

async function mockGateway(page: Page, role: "OWNER" | "ADMIN" | "STAFF" | null, routes: Record<string, Handler>, realm: "business" | "client" = "business"): Promise<Mock> {
  const mock: Mock = { calls: [] };
  const base: Record<string, Handler> = {
    "GET /v1/dashboard": () => realm === "client"
      ? { realm: "client", account: { user: { id: UUID(9), email: "c@example.com" } }, dashboard: {}, legal: { pending: [] } }
      : { realm: "business", account: { role, user: { id: UUID(1), email: "owner@example.com", fullName: "Olivia Owner", hasPassword: true } }, business: { name: "Test Salon", currency: "USD", onboardingCompletedAt: "2026-01-01T00:00:00Z" }, dashboard: { businessHealth: { score: 80 }, recentActivity: [] }, legal: { pending: [] } },
  };
  await page.route(`${GATEWAY}/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204 });
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    mock.calls.push({ method, path: url.pathname + url.search, body });
    const handler = routes[`${method} ${url.pathname}`] ?? base[`${method} ${url.pathname}`];
    if (!handler) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found." }) });
    const result = handler(body, url);
    const [status, payload] = Array.isArray(result) && typeof result[0] === "number" ? result as [number, unknown] : [200, result];
    return route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:4321", "access-control-allow-credentials": "true" }, body: JSON.stringify(payload ?? {}) });
  });
  return mock;
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) errors.push(message.text()); });
  return errors;
}

test.describe("business dashboard", () => {
  test("overview shows the attention queue and escapes server data", async ({ page }) => {
    const errors = watchErrors(page);
    await mockGateway(page, "OWNER", {
      "GET /v1/business/attention": () => ({ total: 1, items: [{ category: "payment_outstanding", id: UUID(2), customerId: UUID(3), customerName: XSS, detail: "Invoice 12", occurredAt: "2026-09-01T00:00:00Z", amount: 40 }] }),
    });
    await page.goto("/dashboard/business/");
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await expect(page.locator("[data-attention-list]")).toContainText("<img src=x");
    expect(await page.locator("[data-attention-list] img").count()).toBe(0);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    await expect(page.locator(`a[href="/dashboard/business/customers/profile?id=${UUID(3)}"]`)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("staff do not see owner-only navigation", async ({ page }) => {
    await mockGateway(page, "STAFF", { "GET /v1/business/attention": () => ({ items: [] }) });
    await page.goto("/dashboard/business/");
    await expect(page.locator('.dashboard-sidebar a[href="/dashboard/business/customers"]')).toBeVisible();
    for (const hidden of ["/dashboard/business/reports", "/dashboard/business/commissions", "/dashboard/business/setup", "/dashboard/business/automation"]) {
      await expect(page.locator(`.dashboard-sidebar a[href="${hidden}"]`)).toBeHidden();
    }
    // Page-level shortcuts to owner/admin surfaces are gated the same way.
    await expect(page.getByRole("link", { name: "Business settings" })).toBeHidden();
  });

  test("services: validation, then a create request with backend-shaped payload", async ({ page }) => {
    const errors = watchErrors(page);
    const services: any[] = [];
    const mock = await mockGateway(page, "OWNER", {
      "GET /v1/business/services": () => services,
      "GET /v1/business/team": () => [{ id: UUID(5), userId: UUID(1), name: "Olivia Owner", role: "OWNER", status: "ACTIVE" }],
      "POST /v1/business/services": (body) => { services.push({ id: UUID(6), ...body, assignments: [] }); return [201, services.at(-1)]; },
    });
    await page.goto("/dashboard/business/services/");
    await page.getByRole("button", { name: "Add service" }).click();
    await page.getByLabel("Name").fill("Skin fade");
    await page.getByLabel("Duration (minutes)").fill("45");
    await page.getByLabel("Price").fill("30");
    await page.getByLabel("Deposit").fill("40");
    await page.getByRole("button", { name: "Save service" }).click();
    await expect(page.locator("[data-editor-message]")).toContainText("deposit cannot be more than the price");
    expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await page.getByLabel("Deposit").fill("10");
    await page.getByRole("button", { name: "Save service" }).click();
    await expect(page.locator("[data-list]")).toContainText("Skin fade");
    const post = mock.calls.find((c) => c.method === "POST" && c.path === "/v1/business/services")!;
    expect(post.body).toMatchObject({ name: "Skin fade", durationMinutes: 45, price: 30, depositAmount: 10, active: true });
    expect(errors).toEqual([]);
  });

  test("quote editor sends line items but never totals, then opens the saved draft", async ({ page }) => {
    const errors = watchErrors(page);
    const quoteId = UUID(7);
    const mock = await mockGateway(page, "OWNER", {
      "GET /v1/business/customers": () => ({ items: [{ id: UUID(3), name: "Casey" }] }),
      "POST /v1/business/quotes": () => [201, { id: quoteId }],
      [`GET /v1/business/quotes/${quoteId}`]: () => ({ id: quoteId, documentType: "QUOTE", documentNumber: "Q-1", status: "DRAFT", currency: "USD", customer: { id: UUID(3), name: "Casey" }, origins: {}, currentRevision: { id: UUID(8), totals: { subtotal: "90.00", discountTotal: "0.00", taxTotal: "0.00", total: "90.00" }, lineItems: [{ description: "Deep clean", quantity: "2.00", unitPrice: "45.00", discountAmount: "0.00", taxable: true, lineTotal: "90.00" }] }, revisionHistory: [] }),
    });
    await page.goto("/dashboard/business/quotes/document/?new=QUOTE");
    await page.locator("[name=customerId]").selectOption(UUID(3));
    await page.locator("[data-line] [name=description]").fill("Deep clean");
    await page.locator("[name=quantity]").fill("2");
    await page.locator("[name=unitPrice]").fill("45");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(new RegExp(`id=${quoteId}`));
    await expect(page.locator("[data-summary]")).toContainText("$90.00");
    const post = mock.calls.find((c) => c.method === "POST" && c.path === "/v1/business/quotes")!;
    expect(post.body).toMatchObject({ documentType: "QUOTE", customerId: UUID(3), lineItems: [{ description: "Deep clean", quantity: "2", unitPrice: "45" }] });
    for (const key of ["total", "subtotal", "currency", "status", "businessId"]) expect(post.body).not.toHaveProperty(key);
    expect(errors).toEqual([]);
  });

  test("a customer link is only shown when it is https", async ({ page }) => {
    const id = UUID(7);
    const doc = { id, documentType: "QUOTE", documentNumber: "Q-2", status: "DRAFT", currency: "USD", origins: {}, currentRevision: { id: UUID(8), totals: {}, lineItems: [{ description: "x", quantity: "1", unitPrice: "1", discountAmount: "0", taxable: true, lineTotal: "1" }] }, revisionHistory: [] };
    await mockGateway(page, "OWNER", {
      "GET /v1/business/customers": () => ({ items: [] }),
      [`GET /v1/business/quotes/${id}`]: () => doc,
      [`POST /v1/business/quotes/${id}/send`]: () => ({ acceptanceUrl: "javascript:alert(1)" }),
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(`/dashboard/business/quotes/document/?id=${id}`);
    await page.getByRole("button", { name: "Send to customer" }).click();
    await expect(page.locator("[data-link-panel]")).toBeVisible();
    await expect(page.locator("[data-link-value]")).toHaveValue("");
    await expect(page.locator("[data-link-copy-button]")).toBeHidden();
  });

  test("an invalid document id never reaches the gateway", async ({ page }) => {
    const mock = await mockGateway(page, "OWNER", { "GET /v1/business/customers": () => ({ items: [] }) });
    await page.goto("/dashboard/business/invoices/document/?id=../../admin");
    await expect(page.locator("[data-doc-error]")).toBeVisible();
    expect(mock.calls.some((c) => c.path.includes("admin"))).toBe(false);
  });

  test("team: owner invites and gets a one-time link; staff cannot see invite", async ({ page }) => {
    const errors = watchErrors(page);
    const mock = await mockGateway(page, "OWNER", {
      "GET /v1/business/team": () => [{ id: UUID(5), userId: UUID(1), name: "Olivia Owner", email: "owner@example.com", role: "OWNER", status: "ACTIVE" }, { id: UUID(6), userId: UUID(2), name: "Sam Staff", email: "sam@example.com", role: "STAFF", status: "ACTIVE" }],
      "GET /v1/business/team/summary": () => ({ seats: { current: 2, limit: 5, pendingReservations: 0 } }),
      "GET /v1/business/team/invitations": () => [],
      "POST /v1/business/team/invitations": () => [201, { id: UUID(9), inviteUrl: "https://chakusarecovery.com/team-invite/tok", emailSent: false }],
    });
    await page.goto("/dashboard/business/team/");
    await expect(page.locator("[data-seats]")).toContainText("2 of 5 seats");
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1);
    await page.getByRole("button", { name: "Invite someone" }).click();
    await page.locator("[data-invite-form] [name=email]").fill("new@example.com");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.locator("[data-invite-url]")).toHaveValue("https://chakusarecovery.com/team-invite/tok");
    expect(mock.calls.find((c) => c.method === "POST")!.body).toEqual({ email: "new@example.com", role: "STAFF" });
    expect(errors).toEqual([]);
  });

  test("team as staff: no invite, no role changes", async ({ page }) => {
    await mockGateway(page, "STAFF", {
      "GET /v1/business/team": () => [{ id: UUID(5), userId: UUID(4), name: "Olivia Owner", role: "OWNER", status: "ACTIVE" }, { id: UUID(6), userId: UUID(1), name: "Me", role: "STAFF", status: "ACTIVE" }],
      "GET /v1/business/team/summary": () => ({ seats: { current: 2, limit: 5 } }),
    });
    await page.goto("/dashboard/business/team/");
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite someone" })).toBeHidden();
    await expect(page.getByRole("button", { name: /Make|Remove/ })).toHaveCount(0);
  });

  test("account deletion requires typed confirmation and shows the server's message", async ({ page }) => {
    const mock = await mockGateway(page, "OWNER", { "POST /v1/business/account/delete": () => [400, { error: "Password confirmation failed" }] });
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/dashboard/business/account/");
    await page.locator("[data-delete-form] [name=password]").fill("wrong-password");
    await page.locator("[data-delete-form] [name=confirm]").fill("delete");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.locator("[data-delete-message]")).toContainText("Type DELETE");
    expect(mock.calls.some((c) => c.path === "/v1/business/account/delete")).toBe(false);
    await page.locator("[data-delete-form] [name=confirm]").fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.locator("[data-delete-message]")).toContainText("Password confirmation failed");
    await expect(page).toHaveURL(/\/dashboard\/business\/account/);
  });

  test("calendar renders the week and links bookings to customer profiles", async ({ page }) => {
    const errors = watchErrors(page);
    const now = new Date(); now.setHours(10, 0, 0, 0);
    await mockGateway(page, "OWNER", {
      "GET /v1/business/appointments": () => [{ id: UUID(2), startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 3_600_000).toISOString(), status: "CONFIRMED", serviceName: "Haircut", customer: { id: UUID(3), name: XSS } }],
      "GET /v1/business/calendar-feeds": () => [],
    });
    await page.goto("/dashboard/business/calendar/");
    await expect(page.locator(".calendar-page__item")).toContainText("Haircut");
    await expect(page.locator(`a.calendar-page__item[href*="${UUID(3)}"]`)).toBeVisible();
    expect(await page.locator(".calendar-page__week img").count()).toBe(0);
    await expect(page.getByRole("heading", { name: "Sync to your calendar" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("loyalty: counter lookup marks a reward redeemed", async ({ page }) => {
    const errors = watchErrors(page);
    const mock = await mockGateway(page, "OWNER", {
      "GET /v1/business/loyalty/analytics": () => ({ programActive: true, members: 3, outstandingPoints: 120, last30Days: { pointsEarned: 40 } }),
      "GET /v1/business/loyalty/program": () => ({ active: true, pointsPerCurrency: 1, pointsPerBookingBonus: 10, pointsPerReview: 0, pointsPerReferral: 0, welcomeBonus: 0, pointExpiryDays: null }),
      "GET /v1/business/loyalty/rewards": () => [{ id: UUID(4), name: "Free wash", type: "free_service", pointsCost: 100, active: true }],
      "GET /v1/business/loyalty/accounts": () => ({ items: [] }),
      "GET /v1/business/loyalty/campaigns": () => [],
      "GET /v1/business/loyalty/membership-plans": () => [],
      "GET /v1/business/loyalty/redemptions": () => [{ id: UUID(5), code: "ABC123", status: "issued", reward: { name: "Free wash" } }],
      [`POST /v1/business/loyalty/redemptions/${UUID(5)}/mark-redeemed`]: () => ({ id: UUID(5), status: "redeemed" }),
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/dashboard/business/loyalty/");
    await expect(page.locator("[data-summary]")).toContainText("3 members");
    await page.locator("[data-code-form] [name=code]").fill("abc123");
    await page.getByRole("button", { name: "Look up" }).click();
    await page.getByRole("button", { name: "Mark redeemed" }).click();
    await expect(page.locator("[data-code-message]")).toHaveText("Redeemed.");
    expect(mock.calls.some((c) => c.path === "/v1/business/loyalty/redemptions?code=ABC123")).toBe(true);
    expect(errors).toEqual([]);
  });

  test("every request goes to the gateway allowlist host only", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (request) => { const host = new URL(request.url()).hostname; if (host !== "localhost" && host !== "auth.chakusarecovery.com") external.push(request.url()); });
    await mockGateway(page, "OWNER", { "GET /v1/business/attention": () => ({ items: [] }) });
    for (const path of ["/dashboard/business/", "/dashboard/business/services/", "/dashboard/business/plan/", "/dashboard/business/commissions/"]) await page.goto(path);
    expect(external).toEqual([]);
  });
});

test.describe("client dashboard", () => {
  test("invoice payment only ever redirects to Stripe Checkout", async ({ page }) => {
    const id = UUID(7);
    let payUrl = "https://evil.example/pay";
    await mockGateway(page, null, {
      [`GET /v1/client/invoices/${id}`]: () => ({ id, invoiceNumber: "INV-1", status: "SENT", currency: "USD", business: { name: "Test Salon" }, payment: { state: "UNPAID", amountPaid: "0", outstandingBalance: "50.00" }, revision: { totals: { total: "50.00" }, lineItems: [] } }),
      [`POST /v1/client/invoices/${id}/pay`]: () => [201, { checkoutUrl: payUrl }],
    }, "client");
    await page.route("https://evil.example/**", (route) => route.fulfill({ status: 200, body: "evil" }));
    await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Stripe</title>stripe" }));
    await page.goto(`/dashboard/client/invoices/view/?id=${id}`);
    await page.getByRole("button", { name: /Pay \$50\.00/ }).click();
    await expect(page.locator("[data-pay-message]")).toContainText("isn't available");
    await expect(page).toHaveURL(/localhost/);
    payUrl = "https://checkout.stripe.com/c/pay/cs_test_123";
    await page.getByRole("button", { name: /Pay \$50\.00/ }).click();
    await expect(page).toHaveURL(/checkout\.stripe\.com/);
  });

  test("bookings show cancel only when the API allows it", async ({ page }) => {
    await mockGateway(page, null, {
      "GET /v1/client/bookings": () => ({ items: [
        { id: UUID(1), serviceName: "Haircut", status: "CONFIRMED", startsAt: "2026-12-01T10:00:00Z", canCancel: true, business: { name: "Test Salon", slug: "test-salon" } },
        { id: UUID(2), serviceName: "Colour", status: "CONFIRMED", startsAt: "2026-10-01T10:00:00Z", canCancel: false, business: { name: "Test Salon", slug: "bad slug/../x" } },
      ] }),
    }, "client");
    await page.goto("/dashboard/client/bookings/");
    await expect(page.getByRole("button", { name: "Cancel booking" })).toHaveCount(1);
    await expect(page.locator('a[href="/b/test-salon"]')).toHaveCount(1);
    await expect(page.locator('a[href*="bad"]')).toHaveCount(0);
  });
});
