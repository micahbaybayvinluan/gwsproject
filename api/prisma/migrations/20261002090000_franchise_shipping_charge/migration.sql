-- CreateTable
CREATE TABLE "franchise_shipping_charges" (
    "id" TEXT NOT NULL,
    "sales_doc_id" TEXT NOT NULL,
    "dr_si_no" TEXT NOT NULL,
    "franchise_location_id" TEXT NOT NULL,
    "from_location_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TO_FOLLOW',
    "fill_by" DATE NOT NULL,
    "amount" DECIMAL(14,2),
    "courier" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "invoice_id" TEXT,
    "filled_by" TEXT,
    "filled_at" TIMESTAMP(3),
    "reminded_at" TIMESTAMP(3),
    "pending_edit" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_shipping_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "franchise_shipping_charges_sales_doc_id_key" ON "franchise_shipping_charges"("sales_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_shipping_charges_invoice_id_key" ON "franchise_shipping_charges"("invoice_id");

-- CreateIndex
CREATE INDEX "franchise_shipping_charges_status_fill_by_idx" ON "franchise_shipping_charges"("status", "fill_by");

-- CreateIndex
CREATE INDEX "franchise_shipping_charges_franchise_location_id_idx" ON "franchise_shipping_charges"("franchise_location_id");

