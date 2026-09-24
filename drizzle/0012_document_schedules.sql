CREATE TABLE "document_schedules" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"due_on" date NOT NULL,
	"interval_days" integer,
	"lead_days" integer DEFAULT 30 NOT NULL,
	"last_done_on" date,
	"note" text,
	"notified_for" date,
	CONSTRAINT "document_schedules_kind_check" CHECK ("document_schedules"."kind" IN ('expiry','maintenance')),
	CONSTRAINT "document_schedules_lead_check" CHECK ("document_schedules"."lead_days" BETWEEN 0 AND 365),
	CONSTRAINT "document_schedules_interval_check" CHECK ("document_schedules"."interval_days" IS NULL OR "document_schedules"."interval_days" BETWEEN 1 AND 3650)
);
--> statement-breakpoint
ALTER TABLE "document_schedules" ADD CONSTRAINT "document_schedules_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_schedules_due_idx" ON "document_schedules" USING btree ("due_on");