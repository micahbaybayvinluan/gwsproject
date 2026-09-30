-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "user_id" TEXT;

-- CreateTable
CREATE TABLE "sales_targets" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "location_id" TEXT,
    "agent_key" TEXT,
    "agent_name" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approval_request_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_targets_month_kind_status_idx" ON "sales_targets"("month", "kind", "status");

