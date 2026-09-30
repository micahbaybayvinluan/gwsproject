-- CreateTable
CREATE TABLE "agent_incentives" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "agent_key" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "agent_user_id" TEXT,
    "branches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "transactions" INTEGER NOT NULL DEFAULT 0,
    "total_sales" DECIMAL(14,2) NOT NULL,
    "collected" DECIMAL(14,2) NOT NULL,
    "rate_pct" DECIMAL(6,3),
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "form_no" TEXT,
    "approval_request_id" TEXT,
    "prepared_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "hr_signed_by" TEXT,
    "hr_signed_at" TIMESTAMP(3),
    "release_mode" TEXT,
    "release_account_id" TEXT,
    "release_reference" TEXT,
    "release_date" DATE,
    "released_by" TEXT,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "agent_incentives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_incentives_form_no_key" ON "agent_incentives"("form_no");

-- CreateIndex
CREATE INDEX "agent_incentives_month_agent_key_idx" ON "agent_incentives"("month", "agent_key");

