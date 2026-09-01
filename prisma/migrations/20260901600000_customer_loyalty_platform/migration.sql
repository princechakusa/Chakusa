-- PROGRAM 2 LOOP 5: Customer Loyalty, Memberships & Rewards. 10 new tables,
-- no existing column touched. Per-business loyalty; no stored-value cash.


-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "points_per_currency" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "points_per_booking_bonus" INTEGER NOT NULL DEFAULT 0,
    "points_per_review" INTEGER NOT NULL DEFAULT 0,
    "points_per_referral" INTEGER NOT NULL DEFAULT 0,
    "point_expiry_days" INTEGER,
    "currency" TEXT,
    "tier_config" JSONB,
    "welcome_bonus" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "points_balance" INTEGER NOT NULL DEFAULT 0,
    "lifetime_points" INTEGER NOT NULL DEFAULT 0,
    "tier_key" TEXT,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "reward_redemption_id" TEXT,
    "campaign_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "points_cost" INTEGER NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION,
    "service_offering_id" TEXT,
    "min_tier_key" TEXT,
    "auto_grant" BOOLEAN NOT NULL DEFAULT false,
    "milestone_bookings" INTEGER,
    "members_only" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "redemption_validity_days" INTEGER,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" TEXT NOT NULL,
    "reward_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "account_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "code" TEXT NOT NULL,
    "points_spent" INTEGER NOT NULL DEFAULT 0,
    "appointment_id" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "billing_interval" TEXT NOT NULL,
    "price_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT,
    "priority_booking" BOOLEAN NOT NULL DEFAULT false,
    "discount_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "included_service_ids" JSONB,
    "perks" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_memberships" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "billing_interval" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "customer_profile_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "max_uses" INTEGER,
    "referrer_points" INTEGER NOT NULL DEFAULT 0,
    "referee_points" INTEGER NOT NULL DEFAULT 0,
    "referrer_reward_id" TEXT,
    "referee_reward_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "code_id" TEXT NOT NULL,
    "business_id" TEXT,
    "referrer_profile_id" TEXT NOT NULL,
    "referee_profile_id" TEXT,
    "referee_email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "joined_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "rewarded_referrer_at" TIMESTAMP(3),
    "rewarded_referee_at" TIMESTAMP(3),
    "first_booking_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_campaigns" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'multiplier',
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "bonus_points" INTEGER NOT NULL DEFAULT 0,
    "reward_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_business_id_key" ON "loyalty_programs"("business_id");

-- CreateIndex
CREATE INDEX "loyalty_accounts_customer_profile_id_idx" ON "loyalty_accounts"("customer_profile_id");

-- CreateIndex
CREATE INDEX "loyalty_accounts_business_id_tier_key_idx" ON "loyalty_accounts"("business_id", "tier_key");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_business_id_customer_profile_id_key" ON "loyalty_accounts"("business_id", "customer_profile_id");

-- CreateIndex
CREATE INDEX "loyalty_transactions_business_id_created_at_idx" ON "loyalty_transactions"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_transactions_account_id_created_at_idx" ON "loyalty_transactions"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_transactions_business_id_kind_expires_at_idx" ON "loyalty_transactions"("business_id", "kind", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_transactions_account_id_source_type_source_id_kind_key" ON "loyalty_transactions"("account_id", "source_type", "source_id", "kind");

-- CreateIndex
CREATE INDEX "rewards_business_id_active_idx" ON "rewards"("business_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_code_key" ON "reward_redemptions"("code");

-- CreateIndex
CREATE INDEX "reward_redemptions_business_id_status_idx" ON "reward_redemptions"("business_id", "status");

-- CreateIndex
CREATE INDEX "reward_redemptions_customer_profile_id_status_idx" ON "reward_redemptions"("customer_profile_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_customer_profile_id_source_type_source_i_key" ON "reward_redemptions"("customer_profile_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "membership_plans_business_id_active_idx" ON "membership_plans"("business_id", "active");

-- CreateIndex
CREATE INDEX "customer_memberships_business_id_customer_profile_id_status_idx" ON "customer_memberships"("business_id", "customer_profile_id", "status");

-- CreateIndex
CREATE INDEX "customer_memberships_status_current_period_end_idx" ON "customer_memberships"("status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE INDEX "referral_codes_customer_profile_id_idx" ON "referral_codes"("customer_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_customer_profile_id_business_id_key" ON "referral_codes"("customer_profile_id", "business_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_profile_id_status_idx" ON "referrals"("referrer_profile_id", "status");

-- CreateIndex
CREATE INDEX "referrals_status_created_at_idx" ON "referrals"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_code_id_referee_profile_id_key" ON "referrals"("code_id", "referee_profile_id");

-- CreateIndex
CREATE INDEX "loyalty_campaigns_business_id_active_starts_at_ends_at_idx" ON "loyalty_campaigns"("business_id", "active", "starts_at", "ends_at");

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "referral_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_profile_id_fkey" FOREIGN KEY ("referrer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_profile_id_fkey" FOREIGN KEY ("referee_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_campaigns" ADD CONSTRAINT "loyalty_campaigns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

