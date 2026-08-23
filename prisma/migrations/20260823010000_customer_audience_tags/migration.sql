CREATE TABLE "customer_tags" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_tag_assignments" (
  "customer_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_tag_assignments_pkey" PRIMARY KEY ("customer_id", "tag_id")
);

CREATE UNIQUE INDEX "customer_tags_business_id_name_key" ON "customer_tags"("business_id", "name");
CREATE INDEX "customer_tags_business_id_idx" ON "customer_tags"("business_id");
CREATE INDEX "customer_tag_assignments_tag_id_idx" ON "customer_tag_assignments"("tag_id");
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_tag_assignments" ADD CONSTRAINT "customer_tag_assignments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_tag_assignments" ADD CONSTRAINT "customer_tag_assignments_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "customer_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
