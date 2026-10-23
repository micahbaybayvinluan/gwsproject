-- Cash fund expenses "for liquidation": money given out before the final amount is known, tagged to the person liable.
ALTER TABLE "expense_docs" ADD COLUMN "for_liquidation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expense_docs" ADD COLUMN "liable_employee_id" TEXT;
ALTER TABLE "expense_docs" ADD COLUMN "liable_name" TEXT;
ALTER TABLE "expense_docs" ADD COLUMN "liquidated_at" TIMESTAMP(3);
ALTER TABLE "expense_docs" ADD COLUMN "liquidated_by" TEXT;
