-- Advanced Team #12: operational commission rules. Additive only.
CREATE TYPE "CommissionBasis" AS ENUM ('PERCENT_OF_SERVICE_PRICE', 'FIXED_PER_APPOINTMENT');

CREATE TABLE "member_commission_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "business_member_id" TEXT NOT NULL,
    "service_offering_id" TEXT,
    "basis" "CommissionBasis" NOT NULL,
    "rate_percent" DECIMAL(6,3),
    "fixed_amount" DECIMAL(10,2),
    "fixed_currency" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_commission_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "member_commission_rules_business_id_idx" ON "member_commission_rules"("business_id");
CREATE INDEX "member_commission_rules_business_member_id_idx" ON "member_commission_rules"("business_member_id");

-- One service-specific rule per (member, service), and one base rule per member.
CREATE UNIQUE INDEX "member_commission_rules_member_service_key" ON "member_commission_rules"("business_member_id", "service_offering_id") WHERE "service_offering_id" IS NOT NULL;
CREATE UNIQUE INDEX "member_commission_rules_member_base_key" ON "member_commission_rules"("business_member_id") WHERE "service_offering_id" IS NULL;

ALTER TABLE "member_commission_rules" ADD CONSTRAINT "member_commission_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_commission_rules" ADD CONSTRAINT "member_commission_rules_business_member_id_fkey" FOREIGN KEY ("business_member_id") REFERENCES "business_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_commission_rules" ADD CONSTRAINT "member_commission_rules_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
