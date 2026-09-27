-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "address" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "consumption_days" INTEGER;

-- CreateTable
CREATE TABLE "customer_follow_ups" (
    "id" TEXT NOT NULL,
    "sales_doc_id" TEXT NOT NULL,
    "sales_line_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "customer_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "qty" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notified_at" TIMESTAMP(3),
    "sms_sent_at" TIMESTAMP(3),
    "email_sent_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_messages" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "follow_up_id" TEXT,
    "sent_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_follow_ups_sales_line_id_key" ON "customer_follow_ups"("sales_line_id");

-- CreateIndex
CREATE INDEX "customer_follow_ups_status_due_date_idx" ON "customer_follow_ups"("status", "due_date");

-- CreateIndex
CREATE INDEX "customer_follow_ups_location_id_status_idx" ON "customer_follow_ups"("location_id", "status");

-- CreateIndex
CREATE INDEX "customer_messages_follow_up_id_idx" ON "customer_messages"("follow_up_id");

