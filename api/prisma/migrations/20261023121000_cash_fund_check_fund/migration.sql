-- AlterTable
ALTER TABLE "cash_fund_checks" ADD COLUMN     "fund_id" TEXT;

-- checks made so far were of the one fund of the location
UPDATE "cash_fund_checks" c SET "fund_id" = cf."id" FROM "cash_funds" cf WHERE cf."location_id" = c."location_id";
