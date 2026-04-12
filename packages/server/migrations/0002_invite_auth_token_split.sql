-- Split persons.token into invite_token + auth_token.
-- invite_token: stable identifier in shared URLs (known to admin).
-- auth_token: generated on first claim, used for all API auth (unknown to admin).
ALTER TABLE "persons" RENAME COLUMN "token" TO "invite_token";--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "auth_token" text;--> statement-breakpoint
-- Backfill: existing users get auth_token = invite_token so sessions keep working.
UPDATE "persons" SET "auth_token" = "invite_token";--> statement-breakpoint
CREATE UNIQUE INDEX "persons_auth_token_idx" ON "persons" USING btree ("auth_token");
