CREATE TYPE "AuthChallengePurpose" AS ENUM ('APPLE_SIGN_IN', 'APPLE_LINK', 'APPLE_DELETE');

ALTER TABLE "auth_identities"
ADD COLUMN "encrypted_refresh_token" TEXT,
ADD COLUMN "credential_updated_at" TIMESTAMP(3);

CREATE TABLE "auth_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "purpose" "AuthChallengePurpose" NOT NULL,
    "nonce_hash" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_challenges_nonce_hash_key" ON "auth_challenges"("nonce_hash");
CREATE UNIQUE INDEX "auth_challenges_state_hash_key" ON "auth_challenges"("state_hash");
CREATE INDEX "auth_challenges_user_id_idx" ON "auth_challenges"("user_id");
CREATE INDEX "auth_challenges_expires_at_idx" ON "auth_challenges"("expires_at");

ALTER TABLE "auth_challenges"
ADD CONSTRAINT "auth_challenges_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
