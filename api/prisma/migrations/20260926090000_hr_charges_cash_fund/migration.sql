-- HR charges (expired / damaged / cash shortage / other), in-app acknowledgment, write-off charge-to, branch cash fund, contribution remittances
-- CreateEnum
CREATE TYPE "ChargeKind" AS ENUM ('INVENTORY_DISCREPANCY', 'EXPIRED', 'DAMAGED', 'CASH_SHORTAGE', 'OTHER');

-- DropForeignKey
ALTER TABLE "charge_form_lines" DROP CONSTRAINT "charge_form_lines_product_id_fkey";

-- AlterTable
ALTER TABLE "charge_form_allocations" ADD COLUMN     "acknowledged_at" TIMESTAMP(3),
ADD COLUMN     "acknowledged_by" TEXT;

-- AlterTable
ALTER TABLE "charge_form_lines" ADD COLUMN     "description" TEXT,
ALTER COLUMN "product_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "charge_forms" ADD COLUMN     "kind" "ChargeKind" NOT NULL DEFAULT 'INVENTORY_DISCREPANCY',
ADD COLUMN     "source_id" TEXT,
ADD COLUMN     "source_type" TEXT;

-- AlterTable
ALTER TABLE "daily_closes" ADD COLUMN     "charge_form_id" TEXT,
ADD COLUMN     "fund_replenishment" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "expiry_writeoff_docs" ADD COLUMN     "charge_employee_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "charge_form_id" TEXT,
ADD COLUMN     "charge_to" TEXT NOT NULL DEFAULT 'COMPANY';

-- CreateTable
CREATE TABLE "cash_funds" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "imprest_amount" DECIMAL(14,2) NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_fund_txns" (
    "id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balance_after" DECIMAL(14,2) NOT NULL,
    "expense_doc_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_fund_txns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_remittances" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount_ee" DECIMAL(14,2) NOT NULL,
    "amount_er" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "reference_no" TEXT NOT NULL,
    "paid_at" DATE NOT NULL,
    "paid_from_account_id" TEXT,
    "voucher_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_remittances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_funds_location_id_key" ON "cash_funds"("location_id");

-- CreateIndex
CREATE INDEX "cash_fund_txns_location_id_business_date_idx" ON "cash_fund_txns"("location_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_remittances_kind_year_month_key" ON "contribution_remittances"("kind", "year", "month");

-- AddForeignKey
ALTER TABLE "charge_form_lines" ADD CONSTRAINT "charge_form_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_funds" ADD CONSTRAINT "cash_funds_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_fund_txns" ADD CONSTRAINT "cash_fund_txns_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "cash_funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- existing manual charge forms (no discrepancy case) are "other" charges
UPDATE "charge_forms" SET "kind" = 'OTHER' WHERE "discrepancy_case_id" IS NULL;
UPDATE "charge_forms" SET "source_type" = 'DiscrepancyCase', "source_id" = "discrepancy_case_id" WHERE "discrepancy_case_id" IS NOT NULL;

-- Store inspection report and cash fund checks (Field Auditor)
-- CreateTable
CREATE TABLE "cash_fund_checks" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counted_amount" DECIMAL(14,2) NOT NULL,
    "system_balance" DECIMAL(14,2) NOT NULL,
    "variance" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "inspection_id" TEXT,
    "checked_by" TEXT NOT NULL,

    CONSTRAINT "cash_fund_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_inspections" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "inspection_date" DATE NOT NULL,
    "inspector_id" TEXT NOT NULL,
    "staff_on_duty_employee_id" TEXT,
    "staff_on_duty_name" TEXT,
    "items" JSONB NOT NULL,
    "comments" TEXT,
    "cash_fund_counted" DECIMAL(14,2),
    "cash_fund_system" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "staff_acknowledged_at" TIMESTAMP(3),
    "staff_acknowledged_by" TEXT,
    "hr_reviewed_at" TIMESTAMP(3),
    "hr_reviewed_by" TEXT,
    "hr_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_fund_checks_location_id_checked_at_idx" ON "cash_fund_checks"("location_id", "checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "store_inspections_control_no_key" ON "store_inspections"("control_no");

-- CreateIndex
CREATE INDEX "store_inspections_location_id_inspection_date_idx" ON "store_inspections"("location_id", "inspection_date");

-- AddForeignKey
ALTER TABLE "store_inspections" ADD CONSTRAINT "store_inspections_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Count sheets pre-filled with the start-of-day count
-- AlterTable
ALTER TABLE "count_lines" ADD COLUMN     "begin_qty" INTEGER NOT NULL DEFAULT 0;


-- AR payments entered by branches wait for Accounting approval
-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "approval_request_id" TEXT,
ADD COLUMN     "location_id" TEXT,
ADD COLUMN     "requested_sales_doc_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'POSTED';


-- Customer contact number / email on sales and customers
-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "sales_docs" ADD COLUMN     "customer_email" TEXT,
ADD COLUMN     "customer_phone" TEXT;


-- Form numbering: 2-letter branch code + 2-letter form code + running number (e.g. WA-PO-000012)
-- AlterTable
ALTER TABLE "cash_fund_txns" ADD COLUMN     "control_no" TEXT;

-- AlterTable
ALTER TABLE "discrepancy_cases" ADD COLUMN     "case_no" TEXT;

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "short_code" TEXT;

-- AlterTable
ALTER TABLE "transfer_docs" ADD COLUMN     "transfer_in_no" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "cash_fund_txns_control_no_key" ON "cash_fund_txns"("control_no");

-- CreateIndex
CREATE UNIQUE INDEX "discrepancy_cases_case_no_key" ON "discrepancy_cases"("case_no");

-- CreateIndex
CREATE UNIQUE INDEX "locations_short_code_key" ON "locations"("short_code");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_docs_transfer_in_no_key" ON "transfer_docs"("transfer_in_no");


UPDATE "locations" SET "short_code" = CASE "code" WHEN 'WH' THEN 'WH' WHEN 'WESTAVE' THEN 'WA' WHEN 'CSR' THEN 'CS' WHEN 'IMUS' THEN 'IM' WHEN 'LAGUNA' THEN 'LG' WHEN 'DASMA' THEN 'DS' WHEN 'VITOCRUZ' THEN 'VC' WHEN 'OFFICE' THEN 'OF' WHEN '711' THEN 'SE' WHEN 'MAYON' THEN 'MY' WHEN 'MALOLOS' THEN 'ML' WHEN 'PARANAQUE' THEN 'PQ' WHEN 'ISABELA' THEN 'IS' WHEN 'BAGUIO' THEN 'BG' WHEN 'PANGASINAN' THEN 'PG' WHEN 'NAGA' THEN 'NG' WHEN 'BACOLOD' THEN 'BC' WHEN 'CALOOCAN' THEN 'CL' WHEN 'RIZAL' THEN 'RZ' WHEN 'V-TRANSIT' THEN 'IT' WHEN 'V-OPENING' THEN 'OP' WHEN 'V-CUSTRET' THEN 'CR' WHEN 'V-PULLOUT1' THEN 'P1' WHEN 'V-PULLOUT2' THEN 'P2' WHEN 'V-PULLOUT3' THEN 'P3' WHEN 'V-REPLACE' THEN 'RP' END WHERE "short_code" IS NULL AND "code" IN ('WH','WESTAVE','CSR','IMUS','LAGUNA','DASMA','VITOCRUZ','OFFICE','711','MAYON','MALOLOS','PARANAQUE','ISABELA','BAGUIO','PANGASINAN','NAGA','BACOLOD','CALOOCAN','RIZAL','V-TRANSIT','V-OPENING','V-CUSTRET','V-PULLOUT1','V-PULLOUT2','V-PULLOUT3','V-REPLACE');

-- Weekly count sheets by sales associates
-- AlterTable
ALTER TABLE "count_docs" ADD COLUMN     "count_type" TEXT NOT NULL DEFAULT 'AUDIT';


-- Revision log (errors per staff)
-- CreateTable
CREATE TABLE "document_revisions" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "control_no" TEXT,
    "location_id" TEXT,
    "staff_user_id" TEXT,
    "requested_by" TEXT,
    "approved_by" TEXT,
    "reason" TEXT,
    "changes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_revisions_staff_user_id_created_at_idx" ON "document_revisions"("staff_user_id", "created_at");

-- CreateIndex
CREATE INDEX "document_revisions_document_type_document_id_idx" ON "document_revisions"("document_type", "document_id");

