ALTER TABLE "domain_checks" ADD COLUMN "auto" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "interval_days" integer;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "summary" jsonb;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "warned" jsonb;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "auto_error" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "domain_check_interval_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
CREATE INDEX "domain_checks_next_run_idx" ON "domain_checks" USING btree ("next_run_at");--> statement-breakpoint
ALTER TABLE "domain_checks" ADD CONSTRAINT "domain_checks_interval_check" CHECK ("domain_checks"."interval_days" IS NULL OR "domain_checks"."interval_days" BETWEEN 1 AND 365);--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_domain_interval_check" CHECK ("instance_settings"."domain_check_interval_days" BETWEEN 0 AND 365);