-- CreateEnum
CREATE TYPE "BusinessMemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TeamInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- AlterEnum
ALTER TYPE "ActivityEventType" ADD VALUE 'TEAM_MEMBER_INVITED';
ALTER TYPE "ActivityEventType" ADD VALUE 'TEAM_MEMBER_JOINED';
ALTER TYPE "ActivityEventType" ADD VALUE 'TEAM_MEMBER_ROLE_CHANGED';
ALTER TYPE "ActivityEventType" ADD VALUE 'TEAM_MEMBER_REMOVED';

-- AlterEnum
ALTER TYPE "BusinessRole" ADD VALUE 'ADMIN';

-- AlterEnum
ALTER TYPE "Plan" ADD VALUE 'BUSINESS';

-- AlterTable
ALTER TABLE "business_members" ADD COLUMN     "status" "BusinessMemberStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "team_invitations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "invited_email" TEXT NOT NULL,
    "role" "BusinessRole" NOT NULL,
    "token_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by_user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_invitations_token_id_key" ON "team_invitations"("token_id");

-- CreateIndex
CREATE INDEX "team_invitations_business_id_idx" ON "team_invitations"("business_id");

-- CreateIndex
CREATE INDEX "team_invitations_business_id_invited_email_status_idx" ON "team_invitations"("business_id", "invited_email", "status");

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
