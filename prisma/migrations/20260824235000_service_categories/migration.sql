ALTER TABLE "service_offerings" ADD COLUMN "category" TEXT;
CREATE INDEX "service_offerings_business_id_category_sort_order_idx" ON "service_offerings"("business_id", "category", "sort_order");
