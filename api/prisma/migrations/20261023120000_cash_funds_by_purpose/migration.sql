-- DropIndex
DROP INDEX "cash_funds_location_id_key";

-- AlterTable
ALTER TABLE "cash_fund_txns" ADD COLUMN     "franchise_invoice_id" TEXT,
ADD COLUMN     "franchise_payment_id" TEXT,
ADD COLUMN     "sales_doc_id" TEXT;

-- AlterTable
ALTER TABLE "cash_funds" ADD COLUMN     "account_id" TEXT,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Cash fund',
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "expense_docs" ADD COLUMN     "cash_fund_id" TEXT,
ADD COLUMN     "sales_doc_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "cash_funds_location_id_purpose_key" ON "cash_funds"("location_id", "purpose");


-- a fund that already sits on a warehouse becomes "<warehouse> – Office"; the other funds stay the branch's cash fund
UPDATE "cash_funds" cf SET "purpose" = 'OFFICE', "name" = l."name" || ' – Office' FROM "locations" l WHERE l."id" = cf."location_id" AND l."type" = 'WAREHOUSE';
-- expenses already paid from a warehouse fund point to it
UPDATE "expense_docs" e SET "cash_fund_id" = cf."id" FROM "cash_funds" cf WHERE e."paid_from" = 'PETTY_CASH' AND e."is_main" = false AND cf."location_id" = e."location_id";
