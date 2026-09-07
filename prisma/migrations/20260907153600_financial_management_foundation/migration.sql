-- CreateEnum
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque', 'other');

-- CreateEnum
CREATE TYPE "ExpenseReceiptStatus" AS ENUM ('pending', 'uploaded', 'scanning', 'ready', 'quarantined', 'expired');

-- CreateEnum
CREATE TYPE "MileageUnit" AS ENUM ('mi', 'km');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "category_id" TEXT,
    "created_by_member_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "spent_at" TIMESTAMP(3) NOT NULL,
    "vendor" TEXT,
    "description" TEXT,
    "reference" TEXT,
    "payment_method" "ExpensePaymentMethod",
    "appointment_id" TEXT,
    "customer_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_receipts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "declared_mime" TEXT NOT NULL,
    "detected_mime" TEXT,
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "status" "ExpenseReceiptStatus" NOT NULL DEFAULT 'pending',
    "scan_detail" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "uploaded_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mileage_trips" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "created_by_member_id" TEXT NOT NULL,
    "trip_date" TIMESTAMP(3) NOT NULL,
    "distance" DECIMAL(10,2) NOT NULL,
    "unit" "MileageUnit" NOT NULL DEFAULT 'mi',
    "rate_per_unit" DECIMAL(12,4),
    "amount" DECIMAL(12,2),
    "currency" TEXT,
    "purpose" TEXT,
    "from_label" TEXT,
    "to_label" TEXT,
    "appointment_id" TEXT,
    "customer_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mileage_trips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_categories_business_id_archived_at_sort_order_idx" ON "expense_categories"("business_id", "archived_at", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_business_id_slug_key" ON "expense_categories"("business_id", "slug");

-- CreateIndex
CREATE INDEX "expenses_business_id_deleted_at_spent_at_idx" ON "expenses"("business_id", "deleted_at", "spent_at");

-- CreateIndex
CREATE INDEX "expenses_business_id_category_id_spent_at_idx" ON "expenses"("business_id", "category_id", "spent_at");

-- CreateIndex
CREATE INDEX "expense_receipts_business_id_expense_id_idx" ON "expense_receipts"("business_id", "expense_id");

-- CreateIndex
CREATE INDEX "expense_receipts_status_created_at_idx" ON "expense_receipts"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "expense_receipts_business_id_storage_key_key" ON "expense_receipts"("business_id", "storage_key");

-- CreateIndex
CREATE INDEX "mileage_trips_business_id_deleted_at_trip_date_idx" ON "mileage_trips"("business_id", "deleted_at", "trip_date");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "business_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_trips" ADD CONSTRAINT "mileage_trips_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_trips" ADD CONSTRAINT "mileage_trips_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "business_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_trips" ADD CONSTRAINT "mileage_trips_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_trips" ADD CONSTRAINT "mileage_trips_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
