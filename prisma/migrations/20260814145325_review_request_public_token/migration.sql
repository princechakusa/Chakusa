-- AlterTable
ALTER TABLE "review_requests" ADD COLUMN     "public_token_id" TEXT,
ADD COLUMN     "public_token_hash" TEXT,
ADD COLUMN     "public_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "public_token_consumed_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "review_requests_public_token_id_key" ON "review_requests"("public_token_id");
