-- AlterTable
ALTER TABLE "ecom_waybills" ADD COLUMN     "fee_overrides" JSONB,
ADD COLUMN     "overridden_at" TIMESTAMP(3),
ADD COLUMN     "overridden_by" TEXT,
ADD COLUMN     "override_note" TEXT,
ADD COLUMN     "unit_price_override" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "sales_docs" ADD COLUMN     "card_adjust_reason" TEXT,
ADD COLUMN     "card_amount" DECIMAL(14,2),
ADD COLUMN     "card_fee" DECIMAL(14,2),
ADD COLUMN     "card_remittance_id" TEXT;

-- CreateTable
CREATE TABLE "card_remittances" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "received_on" DATE NOT NULL,
    "batch_ref" TEXT,
    "notes" TEXT,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "fee_amount" DECIMAL(14,2) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "proof_attachment_id" TEXT,
    "lines" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approval_request_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_remittances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "card_remittances_control_no_key" ON "card_remittances"("control_no");

-- CreateIndex
CREATE INDEX "card_remittances_status_idx" ON "card_remittances"("status");

