-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "flavor" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "flavors" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "receiving_lines" ADD COLUMN     "flavor" TEXT;

