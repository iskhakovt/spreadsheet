CREATE INDEX "journal_entries_person_id_id_idx" ON "journal_entries" USING btree ("personId","id");--> statement-breakpoint
CREATE INDEX "persons_group_id_idx" ON "persons" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "questions_category_sort_idx" ON "questions" USING btree ("categoryId","sortOrder");