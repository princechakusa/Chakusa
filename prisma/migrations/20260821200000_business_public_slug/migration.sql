-- AlterTable
ALTER TABLE "businesses" ADD COLUMN "public_slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "businesses_public_slug_key" ON "businesses"("public_slug");
