-- AlterTable
ALTER TABLE "agent_consignment_limits" ADD COLUMN     "outlet_id" TEXT,
ADD COLUMN     "outlet_name" TEXT;

-- AlterTable
ALTER TABLE "consignment_agreements" ADD COLUMN     "outlet_id" TEXT;

-- AlterTable
ALTER TABLE "itinerary_stops" ADD COLUMN     "competitors" TEXT,
ADD COLUMN     "shelf_status" TEXT;

-- AlterTable
ALTER TABLE "outlets" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'PROSPECT';

-- CreateTable
CREATE TABLE "outlet_shares" (
    "id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "agent_key" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "outlet_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlet_changes" (
    "id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT NOT NULL,
    "requested_by_name" TEXT NOT NULL,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outlet_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itinerary_claims" (
    "id" TEXT NOT NULL,
    "itinerary_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "itinerary_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outlet_shares_agent_key_idx" ON "outlet_shares"("agent_key");

-- CreateIndex
CREATE UNIQUE INDEX "outlet_shares_outlet_id_agent_key_key" ON "outlet_shares"("outlet_id", "agent_key");

-- CreateIndex
CREATE INDEX "outlet_changes_outlet_id_status_idx" ON "outlet_changes"("outlet_id", "status");

-- AddForeignKey
ALTER TABLE "outlet_shares" ADD CONSTRAINT "outlet_shares_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlet_changes" ADD CONSTRAINT "outlet_changes_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_claims" ADD CONSTRAINT "itinerary_claims_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "itineraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

