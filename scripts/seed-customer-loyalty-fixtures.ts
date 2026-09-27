import { PrismaClient } from "@prisma/client";

/**
 * One-off local fixture: attaches a loyalty program + account + rewards +
 * redemption + membership + invoice to a specific test customer, so the
 * customer-app screens that need real data (Loyalty Business, Loyalty
 * History, Reward Detail, Redemptions, Redemption Detail, Memberships,
 * Membership Plans, Invoice Detail) can actually be visually verified
 * instead of only showing their empty states.
 *
 * Local test DB only. Mirrors scripts/seed-legal-documents.ts's safety guard.
 *
 * Usage:
 *   CHAKUSA_LOCAL_TEST_DATABASE_URL=postgresql://e2e:e2epass@localhost:5432/chakusa_test \
 *     npx tsx scripts/seed-customer-loyalty-fixtures.ts --confirm-seed-local <customer-email> <business-slug>
 */

const CONFIRM_TOKEN = "--confirm-seed-local";
const confirmation = process.argv[2];
const customerEmail = process.argv[3];
const businessSlug = process.argv[4];

if (confirmation !== CONFIRM_TOKEN || !customerEmail || !businessSlug) {
  console.error(`Usage: npx tsx scripts/seed-customer-loyalty-fixtures.ts ${CONFIRM_TOKEN} <customer-email> <business-slug>`);
  process.exit(1);
}

const localTestUrl = process.env.CHAKUSA_LOCAL_TEST_DATABASE_URL;
if (!localTestUrl) {
  console.error("Refusing to run: CHAKUSA_LOCAL_TEST_DATABASE_URL must be supplied by the process environment");
  process.exit(1);
}
let target: URL;
try {
  target = new URL(localTestUrl);
} catch {
  console.error("Refusing to run: CHAKUSA_LOCAL_TEST_DATABASE_URL is not a valid URL");
  process.exit(1);
}
const database = target.pathname.replace(/^\//, "").split("/")[0];
if (
  !(
    ["postgres:", "postgresql:"].includes(target.protocol) &&
    ["localhost", "127.0.0.1", "::1"].includes(target.hostname) &&
    database === "chakusa_test"
  )
) {
  console.error("Refusing to run: target must be the local chakusa_test PostgreSQL database");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: localTestUrl } } });

async function main() {
  const user = await prisma.user.findFirst({ where: { email: customerEmail } });
  if (!user) throw new Error(`No user found for ${customerEmail}`);
  const profile = await prisma.customerProfile.findUnique({ where: { userId: user.id } });
  if (!profile) throw new Error(`No customer profile found for ${customerEmail}`);

  const business = await prisma.business.findFirst({ where: { publicSlug: businessSlug } });
  if (!business) throw new Error(`No business found for slug ${businessSlug}`);
  const member = await prisma.businessMember.findFirst({ where: { businessId: business.id } });
  if (!member) throw new Error(`No business member found for ${businessSlug}`);
  const service = await prisma.serviceOffering.findFirst({ where: { businessId: business.id } });

  console.log(`[seed-customer-loyalty-fixtures] customer=${profile.id} business=${business.id}`);

  // Loyalty program (idempotent - one per business)
  const program = await prisma.loyaltyProgram.upsert({
    where: { businessId: business.id },
    update: {},
    create: {
      businessId: business.id,
      active: true,
      pointsPerCurrency: 1,
      pointsPerBookingBonus: 20,
      welcomeBonus: 50,
      currency: "USD",
      tierConfig: [
        { key: "bronze", name: "Bronze", minPoints: 0, perks: ["Earn 1 point per $1 spent"] },
        { key: "silver", name: "Silver", minPoints: 200, perks: ["10% off select services", "Early access to promotions"] },
        { key: "gold", name: "Gold", minPoints: 500, perks: ["15% off select services", "Priority booking"] },
      ],
    },
  });

  // Loyalty account for this customer
  const account = await prisma.loyaltyAccount.upsert({
    where: { businessId_customerProfileId: { businessId: business.id, customerProfileId: profile.id } },
    update: { pointsBalance: 340, lifetimePoints: 620, tierKey: "silver" },
    create: {
      businessId: business.id,
      customerProfileId: profile.id,
      pointsBalance: 340,
      lifetimePoints: 620,
      tierKey: "silver",
    },
  });

  // A couple of transactions for history
  await prisma.loyaltyTransaction.upsert({
    where: { accountId_sourceType_sourceId_kind: { accountId: account.id, sourceType: "seed", sourceId: "welcome", kind: "earn" } },
    update: {},
    create: { accountId: account.id, businessId: business.id, kind: "earn", points: 50, balanceAfter: 50, reason: "Welcome bonus", sourceType: "seed", sourceId: "welcome" },
  });
  await prisma.loyaltyTransaction.upsert({
    where: { accountId_sourceType_sourceId_kind: { accountId: account.id, sourceType: "seed", sourceId: "booking-1", kind: "earn" } },
    update: {},
    create: { accountId: account.id, businessId: business.id, kind: "earn", points: 270, balanceAfter: 320, reason: "Points from a booking", sourceType: "seed", sourceId: "booking-1" },
  });
  await prisma.loyaltyTransaction.upsert({
    where: { accountId_sourceType_sourceId_kind: { accountId: account.id, sourceType: "seed", sourceId: "redeem-1", kind: "adjust" } },
    update: {},
    create: { accountId: account.id, businessId: business.id, kind: "adjust", points: 20, balanceAfter: 340, reason: "Referral bonus", sourceType: "seed", sourceId: "redeem-1" },
  });

  // Rewards: one redeemable now, one locked behind a higher tier
  const rewardReady = await prisma.reward.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000a1" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-0000000000a1",
      businessId: business.id,
      name: "$10 off your next visit",
      description: "Redeem for $10 off any service.",
      type: "fixed_discount",
      pointsCost: 200,
      value: 10,
      active: true,
    },
  });
  await prisma.reward.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000a2" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-0000000000a2",
      businessId: business.id,
      name: "Free haircut",
      description: "One full-price service, on us.",
      type: "free_service",
      pointsCost: 800,
      minTierKey: "gold",
      active: true,
    },
  });

  // An issued (active/usable) redemption
  await prisma.rewardRedemption.upsert({
    where: { customerProfileId_sourceType_sourceId: { customerProfileId: profile.id, sourceType: "seed", sourceId: "redemption-1" } },
    update: {},
    create: {
      rewardId: rewardReady.id,
      businessId: business.id,
      customerProfileId: profile.id,
      accountId: account.id,
      status: "issued",
      code: "CHAKU-1234",
      pointsSpent: 200,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      sourceType: "seed",
      sourceId: "redemption-1",
    },
  });

  // Membership plan + this customer's membership
  const plan = await prisma.membershipPlan.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000b1" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-0000000000b1",
      businessId: business.id,
      name: "VIP Monthly",
      description: "Priority booking and a discount on every visit.",
      billingInterval: "monthly",
      priceAmount: 25,
      currency: "USD",
      priorityBooking: true,
      discountPercent: 15,
      perks: ["Free birthday touch-up"],
      active: true,
    },
  });
  await prisma.customerMembership.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000b2" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-0000000000b2",
      businessId: business.id,
      customerProfileId: profile.id,
      planId: plan.id,
      status: "active",
      billingInterval: "monthly",
      currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
      autoRenew: true,
    },
  });

  // An unpaid invoice
  const invoiceNumber = "INV-1001";
  const invoice = await prisma.invoice.upsert({
    where: { businessId_invoiceNumber: { businessId: business.id, invoiceNumber } },
    update: {},
    create: {
      businessId: business.id,
      createdByMemberId: member.id,
      customerProfileId: profile.id,
      invoiceNumber,
      status: "SENT",
      currency: "USD",
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 14 * 86_400_000),
    },
  });
  const existingRevision = await prisma.invoiceRevision.findFirst({ where: { invoiceId: invoice.id } });
  const revision = existingRevision ?? await prisma.invoiceRevision.create({
    data: {
      invoiceId: invoice.id,
      revisionNumber: 1,
      subtotal: "60.00",
      taxTotal: "0.00",
      discountTotal: "0.00",
      total: "60.00",
      notes: "Thanks for being a loyal customer!",
      createdByMemberId: member.id,
      lineItems: {
        create: [
          { description: service?.name ?? "Haircut", quantity: "1.00", unitPrice: "60.00", lineTotal: "60.00", taxable: false, sortOrder: 0 },
        ],
      },
    },
  });
  if (!invoice.currentRevisionId) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { currentRevisionId: revision.id } });
  }

  console.log("[seed-customer-loyalty-fixtures] done");
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
