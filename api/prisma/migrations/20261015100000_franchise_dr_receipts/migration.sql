-- CreateTable
CREATE TABLE "franchise_dr_receipts" (
    "id" TEXT NOT NULL,
    "sales_doc_id" TEXT NOT NULL,
    "franchise_location_id" TEXT NOT NULL,
    "from_location_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" TEXT,
    "received_by_name" TEXT,
    "received_at" TIMESTAMP(3),
    "dispute_note" TEXT,
    "disputed_by" TEXT,
    "disputed_at" TIMESTAMP(3),

    CONSTRAINT "franchise_dr_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "franchise_dr_receipts_sales_doc_id_key" ON "franchise_dr_receipts"("sales_doc_id");

-- CreateIndex
CREATE INDEX "franchise_dr_receipts_franchise_location_id_status_idx" ON "franchise_dr_receipts"("franchise_location_id", "status");

