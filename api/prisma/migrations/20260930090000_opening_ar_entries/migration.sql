-- CreateTable
CREATE TABLE "opening_ar_entries" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "customer_id" TEXT,
    "agent_id" TEXT,
    "customer_name" TEXT,
    "dr_si_no" TEXT NOT NULL,
    "doc_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "pdc_bank" TEXT,
    "pdc_cheque_no" TEXT,
    "pdc_date" DATE,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sales_doc_id" TEXT,
    "approval_request_id" TEXT,
    "decision_note" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "opening_ar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opening_ar_entries_status_location_id_idx" ON "opening_ar_entries"("status", "location_id");

