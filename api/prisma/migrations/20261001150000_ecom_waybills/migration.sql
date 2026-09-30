-- CreateTable
CREATE TABLE "ecom_waybills" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "tracking_no" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "weight_g" INTEGER,
    "rts_date" DATE,
    "product_id" TEXT,
    "guessed" BOOLEAN NOT NULL DEFAULT false,
    "source_file" TEXT,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecom_waybills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecom_waybill_hints" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "weight_g" INTEGER NOT NULL,
    "product_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecom_waybill_hints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ecom_waybills_created_at_idx" ON "ecom_waybills"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_waybills_platform_order_id_key" ON "ecom_waybills"("platform", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ecom_waybill_hints_platform_weight_g_key" ON "ecom_waybill_hints"("platform", "weight_g");

