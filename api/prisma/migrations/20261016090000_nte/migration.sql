-- CreateTable
CREATE TABLE "ntes" (
    "id" TEXT NOT NULL,
    "nte_no" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "location_id" TEXT,
    "hr_notice_id" TEXT,
    "subject" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "incident_date" DATE,
    "issued_on" DATE NOT NULL,
    "reply_due_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "reply" TEXT,
    "replied_on" TIMESTAMP(3),
    "replied_by" TEXT,
    "decision" TEXT,
    "decision_note" TEXT,
    "decided_on" TIMESTAMP(3),
    "decided_by" TEXT,
    "void_reason" TEXT,
    "issued_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ntes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ntes_nte_no_key" ON "ntes"("nte_no");

-- CreateIndex
CREATE INDEX "ntes_employee_id_idx" ON "ntes"("employee_id");

-- CreateIndex
CREATE INDEX "ntes_status_idx" ON "ntes"("status");

