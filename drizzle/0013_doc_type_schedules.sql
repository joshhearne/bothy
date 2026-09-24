ALTER TABLE "doc_types" ADD COLUMN "schedule_kind" text;--> statement-breakpoint
ALTER TABLE "doc_types" ADD COLUMN "schedule_due_days" integer;--> statement-breakpoint
ALTER TABLE "doc_types" ADD COLUMN "schedule_interval_days" integer;--> statement-breakpoint
ALTER TABLE "doc_types" ADD COLUMN "schedule_lead_days" integer;--> statement-breakpoint
ALTER TABLE "document_schedules" ADD COLUMN "from_doc_type" boolean DEFAULT false NOT NULL;
