-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'REPLACEMENT_OUT';

-- AlterTable
ALTER TABLE "receiving_docs" ADD COLUMN     "replacement_ticket_id" TEXT;

-- CreateTable
CREATE TABLE "replacement_tickets" (
    "id" TEXT NOT NULL,
    "ticket_no" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "location_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "qty" INTEGER NOT NULL,
    "unit_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "sales_doc_id" TEXT,
    "sales_line_id" TEXT,
    "dr_si_no" TEXT,
    "sale_location_id" TEXT,
    "sale_control_no" TEXT,
    "sale_tier" TEXT,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "replaced_at" TIMESTAMP(3),
    "replaced_by" TEXT,
    "replaced_location_id" TEXT,
    "replacement_product_id" TEXT,
    "replacement_qty" INTEGER,
    "replacement_unit_price" DECIMAL(14,2),
    "replacement_picks" JSONB,
    "price_difference" DECIMAL(14,2),
    "difference_settled_at" TIMESTAMP(3),
    "difference_settled_by" TEXT,
    "difference_note" TEXT,
    "supplier_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "received_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approval_request_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_note" TEXT,
    "reminded_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replacement_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replacement_receipts" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "receiving_doc_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replacement_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "replacement_tickets_ticket_no_key" ON "replacement_tickets"("ticket_no");

-- CreateIndex
CREATE INDEX "replacement_tickets_kind_status_idx" ON "replacement_tickets"("kind", "status");

-- CreateIndex
CREATE INDEX "replacement_tickets_supplier_id_status_idx" ON "replacement_tickets"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "replacement_tickets_sales_doc_id_idx" ON "replacement_tickets"("sales_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "replacement_receipts_ticket_id_receiving_doc_id_product_id_key" ON "replacement_receipts"("ticket_id", "receiving_doc_id", "product_id");

-- AddForeignKey
ALTER TABLE "replacement_receipts" ADD CONSTRAINT "replacement_receipts_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "replacement_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

