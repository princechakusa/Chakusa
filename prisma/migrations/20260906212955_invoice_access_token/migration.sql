-- CreateTable
CREATE TABLE "invoice_access_tokens" (
    "id" TEXT NOT NULL,
    "invoice_revision_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_access_tokens_token_hash_key" ON "invoice_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "invoice_access_tokens_invoice_revision_id_idx" ON "invoice_access_tokens"("invoice_revision_id");

-- AddForeignKey
ALTER TABLE "invoice_access_tokens" ADD CONSTRAINT "invoice_access_tokens_invoice_revision_id_fkey" FOREIGN KEY ("invoice_revision_id") REFERENCES "invoice_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
