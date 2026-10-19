-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "data" JSONB;

-- AlterTable
ALTER TABLE "ntes" ALTER COLUMN "nte_no" DROP NOT NULL;

