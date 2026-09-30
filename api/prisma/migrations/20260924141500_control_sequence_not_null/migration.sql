-- Control sequences: NULL key columns defeat ON CONFLICT (NULLs are distinct). Use '' / 0 sentinels instead.
DROP INDEX IF EXISTS "control_sequences_doc_type_location_id_year_key";
ALTER TABLE "control_sequences" DROP CONSTRAINT IF EXISTS "control_sequences_location_id_fkey";
DELETE FROM "control_sequences";
ALTER TABLE "control_sequences" DROP COLUMN "location_id";
ALTER TABLE "control_sequences" DROP COLUMN "year";
ALTER TABLE "control_sequences" ADD COLUMN "scope_key" TEXT NOT NULL DEFAULT '';
ALTER TABLE "control_sequences" ADD COLUMN "year" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "control_sequences_doc_type_scope_key_year_key" ON "control_sequences"("doc_type", "scope_key", "year");
