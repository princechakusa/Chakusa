-- CreateTable
CREATE TABLE "marketplace_categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "icon" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "trending" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "business_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_marketplace_listings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "discoverable" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "featured_rank" INTEGER,
    "featured_until" TIMESTAMP(3),
    "category_slug" TEXT,
    "subcategory_slug" TEXT,
    "short_tagline" TEXT,
    "photos" JSONB,
    "social_links" JSONB,
    "address_line" TEXT,
    "city" TEXT,
    "region" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "favourite_count" INTEGER NOT NULL DEFAULT 0,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "last_listed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_promotions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "badge" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_business_views" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 1,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_business_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_follows" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_reports" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT,
    "business_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_by_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_recent_searches" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_recent_searches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_categories_slug_key" ON "marketplace_categories"("slug");

-- CreateIndex
CREATE INDEX "marketplace_categories_active_sort_order_idx" ON "marketplace_categories"("active", "sort_order");

-- CreateIndex
CREATE INDEX "marketplace_categories_parent_id_idx" ON "marketplace_categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_marketplace_listings_business_id_key" ON "business_marketplace_listings"("business_id");

-- CreateIndex
CREATE INDEX "business_marketplace_listings_listed_discoverable_featured__idx" ON "business_marketplace_listings"("listed", "discoverable", "featured", "featured_rank");

-- CreateIndex
CREATE INDEX "business_marketplace_listings_category_slug_listed_discover_idx" ON "business_marketplace_listings"("category_slug", "listed", "discoverable");

-- CreateIndex
CREATE INDEX "business_marketplace_listings_city_region_idx" ON "business_marketplace_listings"("city", "region");

-- CreateIndex
CREATE INDEX "marketplace_promotions_business_id_active_idx" ON "marketplace_promotions"("business_id", "active");

-- CreateIndex
CREATE INDEX "marketplace_promotions_active_ends_at_idx" ON "marketplace_promotions"("active", "ends_at");

-- CreateIndex
CREATE INDEX "customer_business_views_customer_profile_id_viewed_at_idx" ON "customer_business_views"("customer_profile_id", "viewed_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_business_views_customer_profile_id_business_id_key" ON "customer_business_views"("customer_profile_id", "business_id");

-- CreateIndex
CREATE INDEX "business_follows_business_id_idx" ON "business_follows"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_follows_customer_profile_id_business_id_key" ON "business_follows"("customer_profile_id", "business_id");

-- CreateIndex
CREATE INDEX "business_reports_status_created_at_idx" ON "business_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "business_reports_business_id_idx" ON "business_reports"("business_id");

-- CreateIndex
CREATE INDEX "customer_recent_searches_customer_profile_id_created_at_idx" ON "customer_recent_searches"("customer_profile_id", "created_at");

-- AddForeignKey
ALTER TABLE "marketplace_categories" ADD CONSTRAINT "marketplace_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "marketplace_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_marketplace_listings" ADD CONSTRAINT "business_marketplace_listings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_promotions" ADD CONSTRAINT "marketplace_promotions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_business_views" ADD CONSTRAINT "customer_business_views_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_follows" ADD CONSTRAINT "business_follows_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reports" ADD CONSTRAINT "business_reports_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_recent_searches" ADD CONSTRAINT "customer_recent_searches_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
