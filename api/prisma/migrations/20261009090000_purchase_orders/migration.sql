-- AlterTable
ALTER TABLE "receiving_docs" ADD COLUMN     "purchase_order_id" TEXT;

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "po_no" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "basis_days" INTEGER NOT NULL DEFAULT 30,
    "cover_days" INTEGER NOT NULL DEFAULT 30,
    "reserve_days" INTEGER NOT NULL DEFAULT 7,
    "deliver_to_id" TEXT,
    "expected_on" DATE,
    "notes" TEXT,
    "approval_request_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "sent_by" TEXT,
    "received_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "reject_note" TEXT,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "wh_on_hand" INTEGER NOT NULL DEFAULT 0,
    "wh_avg_per_day" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "on_order" INTEGER NOT NULL DEFAULT 0,
    "suggested_qty" INTEGER NOT NULL DEFAULT 0,
    "order_qty" INTEGER NOT NULL DEFAULT 0,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_rows" (
    "id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "avg_per_day" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "days_left" DECIMAL(8,1),
    "need" INTEGER NOT NULL DEFAULT 0,
    "suggested_transfer" INTEGER NOT NULL DEFAULT 0,
    "transfer_from_id" TEXT,
    "transfer_qty" INTEGER NOT NULL DEFAULT 0,
    "suggested_alloc" INTEGER NOT NULL DEFAULT 0,
    "alloc_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_no_key" ON "purchase_orders"("po_no");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_status_idx" ON "purchase_orders"("supplier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_po_id_product_id_key" ON "purchase_order_lines"("po_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_rows_line_id_location_id_key" ON "purchase_order_rows"("line_id", "location_id");

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_rows" ADD CONSTRAINT "purchase_order_rows_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "purchase_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

