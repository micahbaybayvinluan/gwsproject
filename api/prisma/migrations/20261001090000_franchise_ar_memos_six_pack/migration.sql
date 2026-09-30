-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "credit_hold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "credit_hold_note" TEXT;

-- AlterTable
ALTER TABLE "sales_docs" ADD COLUMN     "six_pack_stickers" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "franchise_invoices" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "transfer_id" TEXT,
    "franchise_location_id" TEXT NOT NULL,
    "from_location_id" TEXT,
    "issue_date" DATE NOT NULL,
    "original_due_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "original_amount" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "principal_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "penalty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "penalty_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interest_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "waived_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "penalty_applied_on" DATE,
    "interest_through" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "flagged_at" TIMESTAMP(3),
    "reminded_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_payments" (
    "id" TEXT NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "to_penalty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "to_interest" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "to_principal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_on" DATE NOT NULL,
    "mode" TEXT NOT NULL,
    "payment_account_id" TEXT,
    "reference" TEXT,
    "proof_attachment_id" TEXT,
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "franchise_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_ar_adjustments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "transfer_id" TEXT,
    "details" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_ar_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_ar_extensions" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previous_due_date" DATE NOT NULL,
    "requested_due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approval_request_id" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_ar_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memos" (
    "id" TEXT NOT NULL,
    "memo_no" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "addressed_to" TEXT NOT NULL,
    "from_text" TEXT NOT NULL,
    "memo_date" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "table" JSONB,
    "signers" JSONB NOT NULL,
    "audience" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "memos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memo_recipients" (
    "id" TEXT NOT NULL,
    "memo_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMP(3),

    CONSTRAINT "memo_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "six_pack_stickers" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_key" TEXT NOT NULL,
    "email" TEXT,
    "stickers" INTEGER NOT NULL,
    "business_date" DATE NOT NULL,
    "issued_by" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "six_pack_stickers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "six_pack_redemptions" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_key" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "stickers_used" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "expense_id" TEXT,
    "legacy_card_no" TEXT,
    "proof_attachment_id" TEXT,
    "business_date" DATE NOT NULL,
    "redeemed_by" TEXT NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flagged_note" TEXT,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "six_pack_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "franchise_invoices_control_no_key" ON "franchise_invoices"("control_no");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_invoices_transfer_id_key" ON "franchise_invoices"("transfer_id");

-- CreateIndex
CREATE INDEX "franchise_invoices_franchise_location_id_status_idx" ON "franchise_invoices"("franchise_location_id", "status");

-- CreateIndex
CREATE INDEX "franchise_invoices_due_date_idx" ON "franchise_invoices"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_payments_receipt_no_key" ON "franchise_payments"("receipt_no");

-- CreateIndex
CREATE INDEX "franchise_payments_invoice_id_idx" ON "franchise_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "franchise_ar_adjustments_invoice_id_idx" ON "franchise_ar_adjustments"("invoice_id");

-- CreateIndex
CREATE INDEX "franchise_ar_extensions_invoice_id_idx" ON "franchise_ar_extensions"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "memos_memo_no_key" ON "memos"("memo_no");

-- CreateIndex
CREATE INDEX "memos_memo_date_idx" ON "memos"("memo_date");

-- CreateIndex
CREATE INDEX "memo_recipients_user_id_idx" ON "memo_recipients"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memo_recipients_memo_id_user_id_key" ON "memo_recipients"("memo_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "six_pack_stickers_sale_id_key" ON "six_pack_stickers"("sale_id");

-- CreateIndex
CREATE INDEX "six_pack_stickers_phone_key_idx" ON "six_pack_stickers"("phone_key");

-- CreateIndex
CREATE INDEX "six_pack_stickers_location_id_business_date_idx" ON "six_pack_stickers"("location_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "six_pack_redemptions_control_no_key" ON "six_pack_redemptions"("control_no");

-- CreateIndex
CREATE INDEX "six_pack_redemptions_phone_key_idx" ON "six_pack_redemptions"("phone_key");

-- CreateIndex
CREATE INDEX "six_pack_redemptions_location_id_business_date_idx" ON "six_pack_redemptions"("location_id", "business_date");

-- AddForeignKey
ALTER TABLE "franchise_payments" ADD CONSTRAINT "franchise_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "franchise_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_ar_adjustments" ADD CONSTRAINT "franchise_ar_adjustments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "franchise_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_ar_extensions" ADD CONSTRAINT "franchise_ar_extensions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "franchise_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memo_recipients" ADD CONSTRAINT "memo_recipients_memo_id_fkey" FOREIGN KEY ("memo_id") REFERENCES "memos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

