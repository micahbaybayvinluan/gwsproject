-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN     "voucher_code" TEXT;

-- AlterTable
ALTER TABLE "sales_docs" ADD COLUMN     "voucher_discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "voucher_id" TEXT;

-- CreateTable
CREATE TABLE "member_vouchers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "min_purchase" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "expires_on" DATE NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_sale_id" TEXT,
    "discount_applied" DECIMAL(14,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "member_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_points_entries" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "member_points_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_notes" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "created_by_name" TEXT,

    CONSTRAINT "member_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_offers" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "member_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_invites" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL,
    "invite_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_items" (
    "id" TEXT NOT NULL,
    "response_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "would_buy_again" BOOLEAN NOT NULL,
    "comment" TEXT,

    CONSTRAINT "survey_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_sales" (
    "id" TEXT NOT NULL,
    "product_id" TEXT,
    "item_text" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "member_id" TEXT,
    "location_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "lost_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "location_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_alert_requests" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),

    CONSTRAINT "stock_alert_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_auto_messages" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_auto_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_vouchers_code_key" ON "member_vouchers"("code");

-- CreateIndex
CREATE INDEX "member_vouchers_member_id_used_at_idx" ON "member_vouchers"("member_id", "used_at");

-- CreateIndex
CREATE INDEX "member_points_entries_member_id_idx" ON "member_points_entries"("member_id");

-- CreateIndex
CREATE INDEX "member_notes_member_id_created_at_idx" ON "member_notes"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "member_offers_product_id_active_idx" ON "member_offers"("product_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "survey_invites_token_key" ON "survey_invites"("token");

-- CreateIndex
CREATE UNIQUE INDEX "survey_invites_sale_id_key" ON "survey_invites"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_responses_invite_id_key" ON "survey_responses"("invite_id");

-- CreateIndex
CREATE INDEX "survey_responses_member_id_idx" ON "survey_responses"("member_id");

-- CreateIndex
CREATE INDEX "survey_items_product_id_idx" ON "survey_items"("product_id");

-- CreateIndex
CREATE INDEX "lost_sales_product_id_created_at_idx" ON "lost_sales"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "lost_sales_location_id_created_at_idx" ON "lost_sales"("location_id", "created_at");

-- CreateIndex
CREATE INDEX "reservations_location_id_status_idx" ON "reservations"("location_id", "status");

-- CreateIndex
CREATE INDEX "stock_alert_requests_product_id_notified_at_idx" ON "stock_alert_requests"("product_id", "notified_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_auto_messages_kind_key_key" ON "member_auto_messages"("kind", "key");

-- AddForeignKey
ALTER TABLE "member_vouchers" ADD CONSTRAINT "member_vouchers_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_points_entries" ADD CONSTRAINT "member_points_entries_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_notes" ADD CONSTRAINT "member_notes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "survey_invites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_items" ADD CONSTRAINT "survey_items_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "survey_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

