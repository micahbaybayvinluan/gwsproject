-- AlterEnum
ALTER TYPE "TransferType" ADD VALUE 'ECOMMERCE';

-- CreateTable
CREATE TABLE "ecom_sku_maps" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platform_sku" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecom_sku_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_orders" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "tracking_no" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pull_out_id" TEXT,
    "settlement_id" TEXT,
    "sales_doc_id" TEXT,
    "source_file" TEXT,
    "shipped_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecom_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "platform_sku" TEXT NOT NULL,
    "product_name" TEXT,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "ecom_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_settlements" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "doc_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source_file" TEXT,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "gross_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "seller_discounts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commission" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transaction_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shipping_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "affiliate_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_fees" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunds" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "withholding_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "adjustments" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payout" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "file_payout" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cost_of_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "include_unmatched" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB NOT NULL,
    "approval_request_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecom_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_returns" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "ecom_order_id" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lines" JSONB NOT NULL,
    "writeoff_id" TEXT,
    "received_by" TEXT,
    "received_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecom_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_ad_spend" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_from_account_id" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "source_file" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecom_ad_spend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ecom_sku_maps_platform_platform_sku_key" ON "ecom_sku_maps"("platform", "platform_sku");

-- CreateIndex
CREATE INDEX "ecom_orders_platform_status_idx" ON "ecom_orders"("platform", "status");

-- CreateIndex
CREATE INDEX "ecom_orders_pull_out_id_idx" ON "ecom_orders"("pull_out_id");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_orders_platform_order_id_key" ON "ecom_orders"("platform", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_settlements_control_no_key" ON "ecom_settlements"("control_no");

-- CreateIndex
CREATE INDEX "ecom_settlements_platform_doc_date_idx" ON "ecom_settlements"("platform", "doc_date");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_returns_control_no_key" ON "ecom_returns"("control_no");

-- CreateIndex
CREATE INDEX "ecom_returns_platform_status_idx" ON "ecom_returns"("platform", "status");

-- CreateIndex
CREATE INDEX "ecom_ad_spend_platform_month_idx" ON "ecom_ad_spend"("platform", "month");

-- AddForeignKey
ALTER TABLE "ecom_order_lines" ADD CONSTRAINT "ecom_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ecom_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

