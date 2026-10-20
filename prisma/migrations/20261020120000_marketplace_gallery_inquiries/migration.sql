-- Additive: business gallery photos, Google place link, customer-inquiry lookup index.
ALTER TABLE "businesses" ADD COLUMN "google_place_id" TEXT;

CREATE TABLE "business_gallery_photos" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "mime_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "caption" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_gallery_photos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "business_gallery_photos_business_id_position_idx" ON "business_gallery_photos"("business_id", "position");
ALTER TABLE "business_gallery_photos" ADD CONSTRAINT "business_gallery_photos_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "conversations_context_type_context_id_idx" ON "conversations"("context_type", "context_id");
