CREATE TYPE "public"."question_mode" AS ENUM('all', 'filtered');--> statement-breakpoint
CREATE TYPE "public"."target" AS ENUM('all', 'amab', 'afab');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"sortOrder" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adminToken" text,
	"encrypted" boolean NOT NULL,
	"isReady" boolean NOT NULL,
	"questionMode" "question_mode" NOT NULL,
	"showTiming" boolean NOT NULL,
	"anatomyLabels" text,
	"anatomyPicker" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_adminToken_unique" UNIQUE("adminToken")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"personId" uuid NOT NULL,
	"operation" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"groupId" uuid NOT NULL,
	"name" text NOT NULL,
	"anatomy" text,
	"token" text NOT NULL,
	"isAdmin" boolean NOT NULL,
	"isCompleted" boolean NOT NULL,
	"progress" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"categoryId" text NOT NULL,
	"text" text NOT NULL,
	"giveText" text,
	"receiveText" text,
	"description" text,
	"targetGive" "target" NOT NULL,
	"targetReceive" "target" NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"sortOrder" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_personId_persons_id_fk" FOREIGN KEY ("personId") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_groupId_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_categoryId_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;