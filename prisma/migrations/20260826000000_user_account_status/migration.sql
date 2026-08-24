CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'DISABLED');
ALTER TABLE "users" ADD COLUMN "account_status" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE';
CREATE INDEX "users_account_status_created_at_idx" ON "users"("account_status", "created_at");
