-- CreateTable
CREATE TABLE "promos" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "memo_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "promos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_items" (
    "id" TEXT NOT NULL,
    "promo_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "promo_price" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "promo_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contacts" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "follow_up_id" TEXT,
    "member_id" TEXT,
    "product_id" TEXT,
    "location_id" TEXT NOT NULL,
    "customer_name" TEXT,
    "phone" TEXT,
    "method" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "recontact_on" DATE,
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promos_audience_status_ends_on_idx" ON "promos"("audience", "status", "ends_on");

-- CreateIndex
CREATE INDEX "promo_items_product_id_idx" ON "promo_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_items_promo_id_product_id_key" ON "promo_items"("promo_id", "product_id");

-- CreateIndex
CREATE INDEX "customer_contacts_location_id_created_at_idx" ON "customer_contacts"("location_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_contacts_member_id_idx" ON "customer_contacts"("member_id");

-- CreateIndex
CREATE INDEX "customer_contacts_follow_up_id_idx" ON "customer_contacts"("follow_up_id");

-- CreateIndex
CREATE INDEX "customer_contacts_kind_outcome_idx" ON "customer_contacts"("kind", "outcome");

-- AddForeignKey
ALTER TABLE "promo_items" ADD CONSTRAINT "promo_items_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

