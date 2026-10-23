-- AlterTable
ALTER TABLE "cash_fund_txns" ADD COLUMN     "counter_account_id" TEXT,
ADD COLUMN     "person_name" TEXT,
ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "cash_funds" ADD COLUMN     "voucher_start" INTEGER NOT NULL DEFAULT 1;
