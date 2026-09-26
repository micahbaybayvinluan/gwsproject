-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "franchise_associate_receives" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transfer_docs" ADD COLUMN     "pending_receipt" JSONB,
ADD COLUMN     "pending_receipt_by" TEXT;

-- CreateTable
CREATE TABLE "price_update_logs" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "tier" TEXT,
    "old_value" DECIMAL(14,2),
    "new_value" DECIMAL(14,2),
    "effective_from" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "link" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_update_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_salaries" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "basic" DECIMAL(14,2) NOT NULL,
    "allowances" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "charges_deducted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_pay" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "expense_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "franchise_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_charges" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "reason" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "source_charge_form_id" TEXT,
    "salary_id" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "franchise_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_update_logs_created_at_idx" ON "price_update_logs"("created_at");

-- CreateIndex
CREATE INDEX "franchise_salaries_location_id_user_id_idx" ON "franchise_salaries"("location_id", "user_id");

-- CreateIndex
CREATE INDEX "franchise_charges_location_id_user_id_idx" ON "franchise_charges"("location_id", "user_id");

