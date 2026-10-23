-- Every franchise branch has a franchisee customer linked to it, so a DR sold to the franchisee reaches the franchise's owner and associates.
UPDATE "customers" c SET "location_id" = l."id"
FROM "locations" l
WHERE c."type" = 'FRANCHISE' AND c."location_id" IS NULL AND l."type" = 'FRANCHISE'
  AND (lower(c."name") = lower(l."name") OR lower(c."name") = lower('Franchise ' || l."name"))
  AND NOT EXISTS (SELECT 1 FROM "customers" x WHERE x."location_id" = l."id" AND x."type" = 'FRANCHISE');

INSERT INTO "customers" ("id", "code", "name", "type", "location_id", "active", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'FR-' || l."code", 'Franchise ' || l."name", 'FRANCHISE', l."id", true, now(), now()
FROM "locations" l
WHERE l."type" = 'FRANCHISE'
  AND NOT EXISTS (SELECT 1 FROM "customers" x WHERE x."location_id" = l."id" AND x."type" = 'FRANCHISE')
  AND NOT EXISTS (SELECT 1 FROM "customers" y WHERE y."code" = 'FR-' || l."code");
