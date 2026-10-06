ALTER TABLE "kb_articles" ADD COLUMN "kind" text DEFAULT 'article' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD COLUMN "steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "kb_articles_runbook_idx" ON "kb_articles" USING btree ("collection_id") WHERE "kb_articles"."kind" = 'runbook';--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_kind_check" CHECK ("kb_articles"."kind" IN ('article','runbook'));