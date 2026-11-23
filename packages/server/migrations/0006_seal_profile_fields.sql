-- Seal legacy raw profile fields. Legacy rows in plaintext groups hold
-- persons.name and persons.anatomy raw ("Alice", "afab"), while every write
-- path requires the sealed `p:N:` / `e:N:` form. Rewrite each raw value to
-- `p:1:<json>`, the form a plaintext group's codec produces. In an encrypted
-- group a raw value is plaintext an older client leaked: as `p:1:`, other
-- members' clients drop it on read and its owner's client re-seals it under
-- the group key (design/sync.md § Sealed values). Progress and journal
-- operations are already sealed in every row.
--
-- Postgres' to_json escapes text the way JSON.stringify does, so the payload
-- round-trips through JSON.parse. Sealed values match the pattern and are
-- skipped, which makes a second run a no-op.
UPDATE "persons" SET "name" = 'p:1:' || to_json("name")::text WHERE "name" !~ '^[pe]:[0-9]+:';
--> statement-breakpoint
UPDATE "persons" SET "anatomy" = 'p:1:' || to_json("anatomy")::text WHERE "anatomy" IS NOT NULL AND "anatomy" !~ '^[pe]:[0-9]+:';
