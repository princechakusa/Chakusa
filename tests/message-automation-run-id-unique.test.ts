import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount, setPlan } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createAutomationRule } from "../src/modules/automation/automation.service.js";
import { buildLeadCreatedDedupeKey } from "../src/lib/automation/dedupeKey.js";
import { LEAD_SOURCE_MISSED_CALL } from "../src/lib/leadSources.js";

/**
 * Focused coverage for the database-level unique constraint on
 * Message.automationRunId — defense in depth alongside the
 * application-level idempotency check in executeAutomationRun
 * (src/lib/automation/executor.ts), which looks up an existing Message by
 * automationRunId before ever sending again for the same run.
 */
describe("Message.automationRunId uniqueness", () => {
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

  async function makeRun(businessId: string) {
    await setPlan(businessId, "PRO");
    const rule = await createAutomationRule(businessId, "PRO", {
      name: "Missed call recovery",
      enabled: true,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });
    const customer = await prisma.customer.create({ data: { businessId, name: "Test Customer", phoneE164: "+263771234567" } });
    const lead = await prisma.lead.create({ data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new" } });
    const run = await prisma.automationRun.create({
      data: {
        businessId,
        automationRuleId: rule.id,
        customerId: customer.id,
        leadId: lead.id,
        dedupeKey: buildLeadCreatedDedupeKey(rule.id, lead.id),
        scheduledFor: new Date(),
      },
    });
    return { rule, customer, lead, run };
  }

  it("allows exactly one Message for a given AutomationRun", async () => {
    const { businessId } = await registerAccount(app);
    const { run, customer, lead } = await makeRun(businessId);

    const message = await prisma.message.create({
      data: {
        businessId,
        customerId: customer.id,
        leadId: lead.id,
        automationRunId: run.id,
        messageType: "missed_call",
        channel: "sms",
        body: "Following up",
        status: "sent",
      },
    });

    expect(message.automationRunId).toBe(run.id);
    expect(await prisma.message.count({ where: { automationRunId: run.id } })).toBe(1);
  });

  it("rejects a second Message for the same AutomationRun at the database level", async () => {
    const { businessId } = await registerAccount(app);
    const { run, customer, lead } = await makeRun(businessId);

    await prisma.message.create({
      data: {
        businessId,
        customerId: customer.id,
        leadId: lead.id,
        automationRunId: run.id,
        messageType: "missed_call",
        channel: "sms",
        body: "First send",
        status: "sent",
      },
    });

    await expect(
      prisma.message.create({
        data: {
          businessId,
          customerId: customer.id,
          leadId: lead.id,
          automationRunId: run.id,
          messageType: "missed_call",
          channel: "sms",
          body: "Duplicate send attempt",
          status: "sent",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // Confirm it's genuinely a Prisma unique-constraint violation, not some
    // other error, and that the duplicate never landed.
    expect(await prisma.message.count({ where: { automationRunId: run.id } })).toBe(1);
  });

  it("allows any number of Messages with automationRunId = null", async () => {
    const { businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Manual Customer", phoneE164: "+263779999999" } });

    for (let i = 0; i < 3; i += 1) {
      await prisma.message.create({
        data: {
          businessId,
          customerId: customer.id,
          messageType: "custom",
          channel: "sms",
          body: `Manual message ${i}`,
          status: "sent",
          automationRunId: null,
        },
      });
    }

    expect(await prisma.message.count({ where: { businessId, automationRunId: null } })).toBe(3);
  });

  it("leaves the existing manual-send path (Phase 2, no automationRunId at all) working", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await prisma.customer.create({ data: { businessId, name: "Manual Send", phoneE164: "+15005550006" } });

    const response = await app.inject({
      method: "POST",
      url: "/messages/send",
      headers: { authorization: `Bearer ${token}` },
      payload: { customerId: customer.id, body: "hello from manual send" },
    });

    // No live Twilio credentials in the test environment — accept anything
    // other than the entitlement/validation failures this task could have
    // caused; the point is the manual-send path (and its unconstrained
    // automationRunId: null) still functions.
    expect(response.statusCode).not.toBe(403);
    expect(response.statusCode).not.toBe(404);

    const message = await prisma.message.findFirst({ where: { businessId } });
    expect(message?.automationRunId).toBeNull();
  });

  it("still enforces the constraint via the real Prisma error type", async () => {
    const { businessId } = await registerAccount(app);
    const { run, customer, lead } = await makeRun(businessId);

    await prisma.message.create({
      data: { businessId, customerId: customer.id, leadId: lead.id, automationRunId: run.id, messageType: "missed_call", channel: "sms", body: "A", status: "sent" },
    });

    try {
      await prisma.message.create({
        data: { businessId, customerId: customer.id, leadId: lead.id, automationRunId: run.id, messageType: "missed_call", channel: "sms", body: "B", status: "sent" },
      });
      throw new Error("expected the second create to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    }
  });
});
