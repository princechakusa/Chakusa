-- Inventory #13: stock items with an append-only, auditable movement ledger.
-- Additive only — no change to any existing table.
CREATE TYPE "InventoryMovementKind" AS ENUM ('OPENING', 'RECEIVE', 'RESTOCK', 'CONSUME', 'SERVICE_USE', 'WASTE', 'ADJUST', 'CORRECTION');

CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT,
    "low_stock_threshold" DECIMAL(12,3),
    "allow_negative" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_items_business_id_name_key" ON "inventory_items"("business_id", "name");
CREATE INDEX "inventory_items_business_id_active_idx" ON "inventory_items"("business_id", "active");

CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "kind" "InventoryMovementKind" NOT NULL,
    "quantity_delta" DECIMAL(12,3) NOT NULL,
    "balance_after" DECIMAL(12,3) NOT NULL,
    "reason" TEXT,
    "reference" TEXT,
    "appointment_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_movements_business_id_item_id_created_at_idx" ON "inventory_movements"("business_id", "item_id", "created_at");
CREATE INDEX "inventory_movements_appointment_id_idx" ON "inventory_movements"("appointment_id");

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
