/**
 * #25 — release-candidate QA seed. Creates ONE business workspace with an
 * OWNER / ADMIN / STAFF member, ONE customer account, and a spread of data
 * across every feature the QA matrix exercises. No production secrets: the
 * fake AI provider, test passwords, and no real Twilio/Stripe are used.
 *
 * Run:  npm run seed:qa -- --i-understand-this-writes-test-data
 *
 * Refuses to run unless (a) the flag is present, (b) DATABASE_URL host is
 * loopback, and (c) the database name looks like a dev/qa/test database and
 * carries no production indicator. Fail closed.
 */
import { registerUser } from "../src/modules/auth/auth.service.js";
import { registerCustomer } from "../src/modules/customerAuth/customerAuth.service.js";
import { prisma } from "../src/lib/prisma.js";

const CONFIRM = "--i-understand-this-writes-test-data";
const PASSWORD = "qa-password-123456";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PROD_INDICATORS = ["prod", "production", "render.com", "railway.app", "neon.tech", "supabase", "amazonaws", "aws-0-"];

function assertSafe() {
  if (!process.argv.includes(CONFIRM)) {
    console.error(`Refused. Re-run with:  npm run seed:qa -- ${CONFIRM}`);
    process.exit(1);
  }
  const raw = process.env.DATABASE_URL ?? "";
  let host = "";
  try { host = new URL(raw).hostname.toLowerCase(); } catch { /* handled below */ }
  const lower = raw.toLowerCase();
  const dbName = lower.split("/").pop()?.split("?")[0] ?? "";
  if (!LOOPBACK.has(host)) { console.error(`Refused: DATABASE_URL host "${host}" is not loopback.`); process.exit(1); }
  if (PROD_INDICATORS.some((p) => lower.includes(p))) { console.error("Refused: DATABASE_URL carries a production indicator."); process.exit(1); }
  if (!/(qa|dev|test|local)/.test(dbName)) { console.error(`Refused: database "${dbName}" is not clearly a dev/qa/test database.`); process.exit(1); }
}

const stamp = Date.now().toString(36);
const email = (role: string) => `qa-${role}-${stamp}@chakusa.test`;

async function main() {
  assertSafe();

  // --- accounts -----------------------------------------------------------
  const owner = await registerUser({ email: email("owner"), password: PASSWORD, fullName: "Olive Owner", businessName: `QA Salon ${stamp}`, industry: "hair salon" });
  const businessId = owner.business.id;

  const addMember = async (role: "ADMIN" | "STAFF", name: string) => {
    const u = await prisma.user.create({ data: { email: email(role.toLowerCase()), normalizedEmail: email(role.toLowerCase()), fullName: name, passwordHash: owner.user.passwordHash } });
    await prisma.businessMember.create({ data: { businessId, userId: u.id, role, status: "ACTIVE" } });
    return u;
  };
  await addMember("ADMIN", "Amir Admin");
  await addMember("STAFF", "Sam Staff");
  const ownerMember = await prisma.businessMember.findFirstOrThrow({ where: { businessId, userId: owner.user.id } });

  const customerEmail = email("customer");
  await registerCustomer({ email: customerEmail, password: PASSWORD, fullName: "Casey Customer" });

  // --- business config --------------------------------------------------
  const openEveryDay = { version: 1, days: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { enabled: true, opensAt: "08:00", closesAt: "18:00" }])) };
  await prisma.business.update({
    where: { id: businessId },
    data: {
      phone: "+15005550000", timezone: "UTC", workingHours: openEveryDay,
      messagingConsentConfirmedAt: new Date(), noShowFollowUpEnabled: true,
      reviewRequestAutoEnabled: true, paymentRemindersEnabled: true,
      googleReviewLink: "https://g.page/r/qa-demo/review",
      description: "A QA demo salon for release-candidate testing.",
    },
  });
  await prisma.subscription.update({ where: { businessId }, data: { plan: "BUSINESS", status: "ACTIVE" } });

  const services = await Promise.all([
    prisma.serviceOffering.create({ data: { businessId, name: "Haircut", durationMinutes: 45, price: 40, publiclyBookable: true, sortOrder: 1 } }),
    prisma.serviceOffering.create({ data: { businessId, name: "Colour", durationMinutes: 90, price: 120, publiclyBookable: true, sortOrder: 2 } }),
    prisma.serviceOffering.create({ data: { businessId, name: "Consultation (internal)", durationMinutes: 20, publiclyBookable: false, sortOrder: 3 } }),
  ]);

  // --- customers, leads ------------------------------------------------
  const customers = await Promise.all(
    ["Pat Rivera", "Jo Mensah", "Lee Chan", "Sky Ahmed", "Robin Okafor"].map((name, i) =>
      prisma.customer.create({ data: { businessId, name, phone: `+1500555${(1000 + i).toString()}`, phoneE164: `+1500555${(1000 + i).toString()}` } }),
    ),
  );
  for (const [i, status] of ["new", "contacted", "booked", "won", "lost"].entries()) {
    await prisma.lead.create({ data: { businessId, customerId: customers[i].id, serviceRequested: services[i % 2].name, source: ["phone", "website", "referral", "walk_in", "social"][i], status: status as never, urgency: (["low", "medium", "high"] as const)[i % 3], estimatedValue: 50 + i * 25 } });
  }

  // --- appointments across states -------------------------------------
  const now = Date.now();
  const appt = (customerId: string, startOffsetMin: number, status: string, extra: Record<string, unknown> = {}) =>
    prisma.appointment.create({ data: { businessId, customerId, assignedMemberId: ownerMember.id, serviceOfferingId: services[0].id, serviceName: services[0].name, startsAt: new Date(now + startOffsetMin * 60_000), endsAt: new Date(now + (startOffsetMin + 45) * 60_000), status: status as never, createdByUserId: owner.user.id, ...extra } });
  await appt(customers[0].id, 120, "CONFIRMED");
  await appt(customers[1].id, 24 * 60, "SCHEDULED");
  await appt(customers[2].id, -180, "COMPLETED");
  await appt(customers[3].id, -90, "NO_SHOW", { startsAt: new Date(now - 90 * 60_000), endsAt: new Date(now - 45 * 60_000) });
  await appt(customers[4].id, -24 * 60, "CANCELED");
  const arriving = await appt(customers[0].id, 60, "CONFIRMED", { arrivalState: "ON_MY_WAY", arrivalStateAt: new Date(), arrivalStateByMemberId: ownerMember.id });
  await prisma.appointmentLocationShare.create({ data: { appointmentId: arriving.id, businessId, sharingMemberId: ownerMember.id, latitude: 51.5074, longitude: -0.1278, expiresAt: new Date(now + 30 * 60_000) } });

  // --- inventory -----------------------------------------------------
  const item = await prisma.inventoryItem.create({ data: { businessId, name: "Developer 20 vol", sku: "DEV-20", unit: "ml", lowStockThreshold: 500, createdByUserId: owner.user.id } });
  await prisma.inventoryMovement.create({ data: { businessId, itemId: item.id, kind: "OPENING", quantityDelta: 1000, balanceAfter: 1000, createdByUserId: owner.user.id } });
  await prisma.inventoryMovement.create({ data: { businessId, itemId: item.id, kind: "CONSUME", quantityDelta: -600, balanceAfter: 400, createdByUserId: owner.user.id, reason: "QA demo consumption" } });

  // --- reviews + feedback -----------------------------------------
  const rr = await prisma.reviewRequest.create({ data: { businessId, customerId: customers[2].id, serviceName: services[0].name, status: "sent", sentAt: new Date() } });
  await prisma.feedback.create({ data: { businessId, customerId: customers[2].id, reviewRequestId: rr.id, rating: 5, comment: "Fantastic, thank you!", sentiment: "positive" } });
  await prisma.feedback.create({ data: { businessId, customerId: customers[3].id, rating: 2, comment: "Waited too long.", sentiment: "negative", response: "Sorry about the wait — we've added Saturday staff.", respondedAt: new Date(), respondedByUserId: owner.user.id } });

  // --- conversation + messages ----------------------------------
  const conversation = await prisma.conversation.create({ data: { businessId, customerId: customers[0].id, status: "OPEN", lastInboundAt: new Date(), participants: { create: { businessId, customerId: customers[0].id, externalAddress: customers[0].phoneE164, role: "CUSTOMER" } } } });
  await prisma.message.create({ data: { businessId, customerId: customers[0].id, conversationId: conversation.id, messageType: "custom", channel: "sms", body: "Hi, can I move my appointment to Friday?", status: "sent", direction: "INBOUND", actorType: "CUSTOMER", provider: "twilio", providerMessageId: `qa-in-${stamp}` } });
  await prisma.message.create({ data: { businessId, customerId: customers[0].id, conversationId: conversation.id, messageType: "custom", channel: "sms", body: "Of course — Friday 2pm works.", status: "sent", direction: "OUTBOUND", actorType: "HUMAN", provider: "twilio", providerMessageId: `qa-out-${stamp}` } });

  // --- AI receptionist (off by default; row present for the settings screen) ---
  await prisma.aiReceptionistSettings.create({ data: { businessId, enabled: false, mode: "AFTER_HOURS_ONLY" } });

  console.log(JSON.stringify({
    ok: true,
    business: { id: businessId, name: owner.business.name, slug: owner.business.publicSlug },
    logins: {
      owner: { email: owner.user.email, password: PASSWORD },
      admin: { email: email("admin"), password: PASSWORD },
      staff: { email: email("staff"), password: PASSWORD },
      customer: { email: customerEmail, password: PASSWORD },
    },
    seeded: { services: services.length, customers: customers.length, leads: 5, appointments: 6, inventoryItems: 1, reviewRequests: 1, feedback: 2, conversations: 1 },
  }, null, 2));
}

main().then(() => prisma.$disconnect()).catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });
