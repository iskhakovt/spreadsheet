CREATE TYPE "public"."compare" AS ENUM('activity', 'agreement', 'disclose');--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "compare" "compare" DEFAULT 'activity' NOT NULL;