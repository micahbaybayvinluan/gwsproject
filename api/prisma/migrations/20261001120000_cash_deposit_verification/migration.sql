-- AlterTable
ALTER TABLE "cash_deposits" ADD COLUMN     "accounting_verified_at" TIMESTAMP(3),
ADD COLUMN     "accounting_verified_by" TEXT,
ADD COLUMN     "approval_request_id" TEXT,
ADD COLUMN     "audit_verified_at" TIMESTAMP(3),
ADD COLUMN     "audit_verified_by" TEXT,
ADD COLUMN     "reject_reason" TEXT,
ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "rejected_by" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING_AUDIT';


-- deposits made before slips were checked stay as they are
UPDATE "cash_deposits" SET "status" = 'VERIFIED';
