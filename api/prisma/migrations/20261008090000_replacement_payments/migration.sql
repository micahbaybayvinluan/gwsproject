-- AlterTable
ALTER TABLE "replacement_tickets" ADD COLUMN     "replaced_on" DATE;

-- CreateTable
CREATE TABLE "replacement_payments" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "direction" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "payment_account_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "approval_request_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "replacement_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "replacement_payments_location_id_business_date_status_idx" ON "replacement_payments"("location_id", "business_date", "status");

-- CreateIndex
CREATE INDEX "replacement_payments_ticket_id_idx" ON "replacement_payments"("ticket_id");

