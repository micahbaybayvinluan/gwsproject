-- AlterEnum
ALTER TYPE "TransferType" ADD VALUE 'MARKETING_PULLOUT';

-- AlterTable
ALTER TABLE "transfer_docs" ADD COLUMN     "endorse_expense" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "expense_at" TIMESTAMP(3),
ADD COLUMN     "expense_by" TEXT,
ADD COLUMN     "expense_status" TEXT;

