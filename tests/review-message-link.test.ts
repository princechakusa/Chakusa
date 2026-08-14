import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { buildPublicReviewUrl } from "../src/lib/publicReviewLinks.js";

function extractPublicReviewToken(message: string): string {
  const match = message.match(/\/r\/([^\s"]+)/);
  if (!match) throw new Error(`No public review link found in message: ${message}`);
  return match[1]!;
}

describe("review-request message generation embeds the public Chakusa link", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createAndGenerate(businessName = "Test Business") {
    const account = await registerAccount(app, { businessName });
    const created = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(account.token),
      payload: { serviceName: "Haircut" },
    });
    const generated = await app.inject({
      method: "POST",
      url: `/review-requests/${created.json().id}/generate-message`,
      headers: authHeader(account.token),
    });
    return { account, reviewRequestId: created.json().id as string, generated };
  }

  it("1. review message contains the public Chakusa URL", async () => {
    const { generated } = await createAndGenerate();

    expect(generated.statusCode).toBe(200);
    expect(generated.json().message).toMatch(/\/r\/[^\s"]+/);
  });

  it("2. URL contains the opaque token, not ReviewRequest.id", async () => {
    const { generated, reviewRequestId } = await createAndGenerate();

    const token = extractPublicReviewToken(generated.json().message);
    expect(token).not.toBe(reviewRequestId);
    expect(token).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
  });

  it("3. URL uses the configured public base URL", async () => {
    const { generated } = await createAndGenerate();

    const token = extractPublicReviewToken(generated.json().message);
    expect(generated.json().message).toContain(buildPublicReviewUrl(token));
  });

  it("4. the embedded token actually resolves via the public GET endpoint", async () => {
    const { generated } = await createAndGenerate("Resolvable Co");

    const token = extractPublicReviewToken(generated.json().message);
    const publicResponse = await app.inject({ method: "GET", url: `/public/reviews/${token}` });

    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json()).toMatchObject({ state: "open", business: { name: "Resolvable Co" } });
  });

  it("5. raw token/hash are never leaked in unrelated authenticated responses", async () => {
    const { account, reviewRequestId } = await createAndGenerate();

    const getResponse = await app.inject({
      method: "GET",
      url: `/review-requests/${reviewRequestId}`,
      headers: authHeader(account.token),
    });
    const listResponse = await app.inject({
      method: "GET",
      url: "/review-requests",
      headers: authHeader(account.token),
    });

    for (const body of [JSON.stringify(getResponse.json()), JSON.stringify(listResponse.json())]) {
      expect(body).not.toMatch(/publicTokenHash|publicTokenId|publicTokenExpiresAt|publicTokenConsumedAt/i);
    }
  });

  it("6. repeated message generation is safe and deterministic (always a fresh, working link)", async () => {
    const { account, reviewRequestId } = await createAndGenerate();

    const second = await app.inject({
      method: "POST",
      url: `/review-requests/${reviewRequestId}/generate-message`,
      headers: authHeader(account.token),
    });
    expect(second.statusCode).toBe(200);
    const secondToken = extractPublicReviewToken(second.json().message);

    const publicResponse = await app.inject({ method: "GET", url: `/public/reviews/${secondToken}` });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json().state).toBe("open");
  });

  it("7. expired-token behavior: regenerating after expiry issues a fresh working link", async () => {
    const { account, reviewRequestId } = await createAndGenerate();

    await prisma.reviewRequest.update({
      where: { id: reviewRequestId },
      data: { publicTokenExpiresAt: new Date(Date.now() - 1000) },
    });

    const regenerated = await app.inject({
      method: "POST",
      url: `/review-requests/${reviewRequestId}/generate-message`,
      headers: authHeader(account.token),
    });
    const token = extractPublicReviewToken(regenerated.json().message);

    const publicResponse = await app.inject({ method: "GET", url: `/public/reviews/${token}` });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json().state).toBe("open");
  });

  it("8. consumed-token behavior: regenerating after feedback submission does not hand out a new working submission link", async () => {
    const { account, reviewRequestId, generated } = await createAndGenerate();
    const firstToken = extractPublicReviewToken(generated.json().message);

    const submit = await app.inject({
      method: "POST",
      url: `/public/reviews/${firstToken}/feedback`,
      payload: { rating: 5, comment: "Loved it" },
    });
    expect(submit.statusCode).toBe(201);

    const regenerated = await app.inject({
      method: "POST",
      url: `/review-requests/${reviewRequestId}/generate-message`,
      headers: authHeader(account.token),
    });
    expect(regenerated.statusCode).toBe(200);
    expect(regenerated.json().message).not.toMatch(/\/r\/[^\s"]+/);

    // The already-consumed token still correctly reports "submitted" — no
    // second working submission link was minted.
    const publicResponse = await app.inject({ method: "GET", url: `/public/reviews/${firstToken}` });
    expect(publicResponse.json().state).toBe("submitted");
    expect(await prisma.feedback.count({ where: { reviewRequestId } })).toBe(1);
  });

  it("9. default review template renders the link", async () => {
    const { generated } = await createAndGenerate();

    expect(generated.json().message).toMatch(/\/r\/[^\s"]+/);
    expect(generated.json().message.length).toBeGreaterThan(0);
  });

  it("10. a custom template using {{review_link}} renders the same public link", async () => {
    const { account, reviewRequestId } = await createAndGenerate();

    await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(account.token),
      payload: {
        templateType: "review_request",
        name: "Custom review ask",
        body: "Hey {{customer_name}}! Tell us how we did: {{review_link}}",
        isDefault: true,
      },
    });

    const generated = await app.inject({
      method: "POST",
      url: `/review-requests/${reviewRequestId}/generate-message`,
      headers: authHeader(account.token),
    });

    expect(generated.json().message).toMatch(/^Hey there! Tell us how we did: /);
    expect(generated.json().message).toMatch(/\/r\/[^\s"]+/);
  });

  it("11. FREE plan can still generate a usable message (no Twilio/automation required)", async () => {
    const { account } = await createAndGenerate();
    await setPlan(account.businessId, "FREE");

    const created = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(account.token),
      payload: { serviceName: "Manicure" },
    });
    const generated = await app.inject({
      method: "POST",
      url: `/review-requests/${created.json().id}/generate-message`,
      headers: authHeader(account.token),
    });

    expect(generated.statusCode).toBe(200);
    expect(generated.json().message).toMatch(/\/r\/[^\s"]+/);
  });

  it("12. the Google review URL is not substituted in place of the Chakusa public URL", async () => {
    const account = await registerAccount(app);
    await app.inject({
      method: "PATCH",
      url: "/business",
      headers: authHeader(account.token),
      payload: { googleReviewLink: "https://g.page/r/distinct-google-link/review" },
    });
    const created = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(account.token),
      payload: {},
    });
    const generated = await app.inject({
      method: "POST",
      url: `/review-requests/${created.json().id}/generate-message`,
      headers: authHeader(account.token),
    });

    expect(generated.json().message).not.toContain("https://g.page/r/distinct-google-link/review");
    expect(generated.json().message).toMatch(/\/r\/[^\s"]+/);

    // The public page itself still offers the Google link — it's just not
    // in the outbound message text.
    const token = extractPublicReviewToken(generated.json().message);
    const publicResponse = await app.inject({ method: "GET", url: `/public/reviews/${token}` });
    expect(publicResponse.json().googleReviewLink).toBe("https://g.page/r/distinct-google-link/review");
  });
});
