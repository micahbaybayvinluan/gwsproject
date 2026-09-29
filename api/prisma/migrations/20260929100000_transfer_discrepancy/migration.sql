-- CreateTable
CREATE TABLE "transfer_discrepancies" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HEAD_AUDITOR',
    "lines" JSONB NOT NULL,
    "received_by" TEXT,
    "sender_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sender_due_at" TIMESTAMP(3),
    "sender_reminded_at" TIMESTAMP(3),
    "history" JSONB NOT NULL DEFAULT '[]',
    "outcome" TEXT,
    "adjustment_doc_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "charge_form_id" TEXT,
    "hr_notice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "transfer_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transfer_discrepancies_transfer_id_key" ON "transfer_discrepancies"("transfer_id");

-- CreateIndex
CREATE INDEX "transfer_discrepancies_status_idx" ON "transfer_discrepancies"("status");

