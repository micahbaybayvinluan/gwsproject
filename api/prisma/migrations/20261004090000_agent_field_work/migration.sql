-- CreateEnum
CREATE TYPE "OutletStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "consignment_agreements" ADD COLUMN     "agent_key" TEXT,
ADD COLUMN     "agent_name" TEXT;

-- AlterTable
ALTER TABLE "sales_docs" ADD COLUMN     "outlet_id" TEXT;

-- CreateTable
CREATE TABLE "sales_areas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "agent_key" TEXT,
    "agent_name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outlet_type" TEXT NOT NULL DEFAULT 'GYM',
    "address" TEXT,
    "city" TEXT,
    "area_id" TEXT,
    "agent_key" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "status" "OutletStatus" NOT NULL DEFAULT 'PENDING',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reject_reason" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itineraries" (
    "id" TEXT NOT NULL,
    "agent_key" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "plan_date" DATE NOT NULL,
    "notes" TEXT,
    "report_submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "itineraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itinerary_stops" (
    "id" TEXT NOT NULL,
    "itinerary_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "note" TEXT,
    "visited_at" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,

    CONSTRAINT "itinerary_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_consignment_limits" (
    "id" TEXT NOT NULL,
    "agent_key" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "approval_request_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "agent_consignment_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_areas_name_key" ON "sales_areas"("name");

-- CreateIndex
CREATE INDEX "outlets_agent_key_idx" ON "outlets"("agent_key");

-- CreateIndex
CREATE INDEX "outlets_area_id_idx" ON "outlets"("area_id");

-- CreateIndex
CREATE UNIQUE INDEX "itineraries_agent_key_plan_date_key" ON "itineraries"("agent_key", "plan_date");

-- CreateIndex
CREATE INDEX "itinerary_stops_outlet_id_idx" ON "itinerary_stops"("outlet_id");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_stops_itinerary_id_outlet_id_key" ON "itinerary_stops"("itinerary_id", "outlet_id");

-- CreateIndex
CREATE INDEX "agent_consignment_limits_agent_key_status_idx" ON "agent_consignment_limits"("agent_key", "status");

-- AddForeignKey
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "sales_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_stops" ADD CONSTRAINT "itinerary_stops_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "itineraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_stops" ADD CONSTRAINT "itinerary_stops_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

