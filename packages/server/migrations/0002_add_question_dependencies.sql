CREATE TABLE "question_dependencies" (
	"questionId" text NOT NULL,
	"requiresQuestionId" text NOT NULL,
	CONSTRAINT "question_dependencies_questionId_requiresQuestionId_pk" PRIMARY KEY("questionId","requiresQuestionId")
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "notePrompt" text;--> statement-breakpoint
ALTER TABLE "question_dependencies" ADD CONSTRAINT "question_dependencies_questionId_questions_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_dependencies" ADD CONSTRAINT "question_dependencies_requiresQuestionId_questions_id_fk" FOREIGN KEY ("requiresQuestionId") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_dependencies_requires_idx" ON "question_dependencies" USING btree ("requiresQuestionId");