CREATE TYPE "AdminRole" AS ENUM (
  'SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'SUPPORT_AGENT',
  'FINANCE',
  'OPERATIONS',
  'READ_ONLY'
);

CREATE TYPE "AdminMembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "AuthSessionScope" AS ENUM ('PRODUCT', 'ADMIN');

ALTER TABLE "auth_sessions"
  ADD COLUMN "scope" "AuthSessionScope" NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN "csrf_token_hash" TEXT,
  ADD COLUMN "ip_address" TEXT,
  ADD COLUMN "user_agent" TEXT;

CREATE INDEX "auth_sessions_user_id_scope_idx" ON "auth_sessions"("user_id", "scope");

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "admin_session_requires_csrf_token"
  CHECK ("scope" <> 'ADMIN' OR "csrf_token_hash" IS NOT NULL);

CREATE TABLE "admin_memberships" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" "AdminRole" NOT NULL,
  "status" "AdminMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "mfa_required" BOOLEAN NOT NULL DEFAULT false,
  "mfa_enrolled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_memberships_user_id_key" ON "admin_memberships"("user_id");
CREATE INDEX "admin_memberships_status_role_idx" ON "admin_memberships"("status", "role");

ALTER TABLE "admin_memberships"
  ADD CONSTRAINT "admin_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "admin_audit_logs" (
  "id" TEXT NOT NULL,
  "admin_membership_id" TEXT,
  "admin_user_id" TEXT,
  "admin_email" TEXT NOT NULL,
  "admin_role" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "old_value" JSONB,
  "new_value" JSONB,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "request_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");
CREATE INDEX "admin_audit_logs_admin_membership_id_created_at_idx" ON "admin_audit_logs"("admin_membership_id", "created_at");
CREATE INDEX "admin_audit_logs_target_type_target_id_created_at_idx" ON "admin_audit_logs"("target_type", "target_id", "created_at");
CREATE INDEX "admin_audit_logs_action_created_at_idx" ON "admin_audit_logs"("action", "created_at");

CREATE FUNCTION reject_admin_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_logs_reject_update
BEFORE UPDATE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_log_mutation();

CREATE TRIGGER admin_audit_logs_reject_delete
BEFORE DELETE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_log_mutation();
