-- AlterTable
ALTER TABLE "promo_items" ADD COLUMN     "discount_pct" INTEGER,
ADD COLUMN     "internal_qty" INTEGER;

-- AlterTable
ALTER TABLE "sales_lines" ADD COLUMN     "promo_id" TEXT,
ADD COLUMN     "promo_ticked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "stock_requests" (
    "id" TEXT NOT NULL,
    "request_no" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "requested_by" TEXT NOT NULL,
    "requested_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handled_by" TEXT,
    "handled_at" TIMESTAMP(3),
    "transfer_id" TEXT,
    "decline_note" TEXT,

    CONSTRAINT "stock_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_request_lines" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "requested_qty" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "stock_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_availabilities" (
    "id" TEXT NOT NULL,
    "list_no" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAREHOUSE_REVIEW',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" TEXT,
    "reviewed_by_name" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "published_to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "franchise_availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_availability_lines" (
    "id" TEXT NOT NULL,
    "availability_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "system_qty" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "flavors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "franchise_availability_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_orders" (
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "availability_id" TEXT NOT NULL,
    "franchise_location_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "notes" TEXT,
    "ordered_by" TEXT NOT NULL,
    "ordered_by_name" TEXT,
    "ordered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "picklist_no" TEXT,
    "picklist_at" TIMESTAMP(3),
    "sent_to_warehouse_at" TIMESTAMP(3),
    "checked_by" TEXT,
    "checked_by_name" TEXT,
    "checked_at" TIMESTAMP(3),
    "check_note" TEXT,
    "sales_doc_id" TEXT,
    "cancel_reason" TEXT,

    CONSTRAINT "franchise_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "flavor" TEXT,
    "qty" INTEGER NOT NULL,
    "checked_qty" INTEGER,

    CONSTRAINT "franchise_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_requests_request_no_key" ON "stock_requests"("request_no");

-- CreateIndex
CREATE INDEX "stock_requests_location_id_status_idx" ON "stock_requests"("location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_request_lines_request_id_product_id_key" ON "stock_request_lines"("request_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_availabilities_list_no_key" ON "franchise_availabilities"("list_no");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_availability_lines_availability_id_product_id_key" ON "franchise_availability_lines"("availability_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_orders_order_no_key" ON "franchise_orders"("order_no");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_orders_picklist_no_key" ON "franchise_orders"("picklist_no");

-- CreateIndex
CREATE INDEX "franchise_orders_availability_id_franchise_location_id_idx" ON "franchise_orders"("availability_id", "franchise_location_id");

-- AddForeignKey
ALTER TABLE "stock_request_lines" ADD CONSTRAINT "stock_request_lines_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stock_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_availability_lines" ADD CONSTRAINT "franchise_availability_lines_availability_id_fkey" FOREIGN KEY ("availability_id") REFERENCES "franchise_availabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_orders" ADD CONSTRAINT "franchise_orders_availability_id_fkey" FOREIGN KEY ("availability_id") REFERENCES "franchise_availabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_order_lines" ADD CONSTRAINT "franchise_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "franchise_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

