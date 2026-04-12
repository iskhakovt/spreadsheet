-- Note: these use plain CREATE INDEX (not CONCURRENTLY) because drizzle's
-- migrator wraps migrations in a transaction (drizzle-orm#860). Safe for our
-- single-container deploy where downtime is inherent. For zero-downtime
-- deploys, apply the indices out-of-band with CONCURRENTLY before migrating.
CREATE INDEX "journal_entries_person_id_id_idx" ON "journal_entries" USING btree ("personId","id");--> statement-breakpoint
CREATE INDEX "persons_group_id_idx" ON "persons" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "questions_category_sort_idx" ON "questions" USING btree ("categoryId","sortOrder");