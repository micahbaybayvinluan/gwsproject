-- CreateTable
CREATE TABLE "sales_report_submissions" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "submitted_by" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgement" TEXT,
    "overall_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_deposit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "sales_report_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_report_submissions_location_id_business_date_key" ON "sales_report_submissions"("location_id", "business_date");

