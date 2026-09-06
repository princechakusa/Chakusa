-- CreateIndex
CREATE INDEX "quote_documents_status_expires_at_idx" ON "quote_documents"("status", "expires_at");
