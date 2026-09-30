-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "cash_deposit_max_days" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "sales_docs" ADD COLUMN     "incentive_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "incentive_expense_id" TEXT,
ADD COLUMN     "incentive_payee" TEXT;

-- CreateTable
CREATE TABLE "cash_deposit_extensions" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "requested_until" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approval_request_id" TEXT,
    "requested_by" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_deposit_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_notices" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "location_id" TEXT,
    "title" TEXT NOT NULL,
    "details" JSONB,
    "staff_ids" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,

    CONSTRAINT "hr_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_deposit_extensions_location_id_business_date_idx" ON "cash_deposit_extensions"("location_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_notices_dedupe_key_key" ON "hr_notices"("dedupe_key");

-- CreateIndex
CREATE INDEX "hr_notices_status_idx" ON "hr_notices"("status");

