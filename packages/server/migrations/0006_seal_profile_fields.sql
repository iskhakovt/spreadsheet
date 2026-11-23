-- Seal legacy raw profile fields. Old clients stored persons.name and
-- persons.anatomy raw ("Alice", "afab") in plaintext groups; every write path
-- now requires the sealed `p:N:` / `e:N:` form. Rewrite each raw value to
-- `p:1:<json>`, the form a plaintext group's codec produces. In encrypted
-- groups a raw value is plaintext leaked by an old client bug: sealing it as
-- p:1: makes new clients reject it on read, and the owner's client re-seals it
-- encrypted. progress and journal operations were always sealed.
--
-- Postgres' to_json escapes text the way JSON.stringify does, so the payload
-- round-trips through JSON.parse. Sealed values match the pattern and are
-- skipped, which makes a second run a no-op.
UPDATE "persons" SET "name" = 'p:1:' || to_json("name")::text WHERE "name" !~ '^[pe]:[0-9]+:';
--> statement-breakpoint
UPDATE "persons" SET "anatomy" = 'p:1:' || to_json("anatomy")::text WHERE "anatomy" IS NOT NULL AND "anatomy" !~ '^[pe]:[0-9]+:';
