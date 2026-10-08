ALTER TABLE "domain_checks" DROP CONSTRAINT "domain_checks_interval_check";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP CONSTRAINT "instance_settings_domain_interval_check";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "domain_dns_interval_days" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "domain_tls_interval_days" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "domain_rdap_interval_days" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "domain_email_interval_days" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "domain_tls_warn_days" integer;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "dns_interval_days" integer;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "tls_interval_days" integer;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "rdap_interval_days" integer;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "email_interval_days" integer;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "dns_next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "tls_next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "rdap_next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "email_next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "tls_auto_renews" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD COLUMN "tls_warn_days" integer;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "domain_dns_interval_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "domain_tls_interval_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "domain_rdap_interval_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "domain_email_interval_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "domain_tls_warn_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_checks" DROP COLUMN "interval_days";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN "domain_check_interval_days";--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_domain_intervals_check" CHECK (("companies"."domain_dns_interval_days" IS NULL OR "companies"."domain_dns_interval_days" BETWEEN 0 AND 365)
      AND ("companies"."domain_tls_interval_days" IS NULL OR "companies"."domain_tls_interval_days" BETWEEN 0 AND 365)
      AND ("companies"."domain_rdap_interval_days" IS NULL OR "companies"."domain_rdap_interval_days" BETWEEN 0 AND 365)
      AND ("companies"."domain_email_interval_days" IS NULL OR "companies"."domain_email_interval_days" BETWEEN 0 AND 365)
      AND ("companies"."domain_tls_warn_days" IS NULL OR "companies"."domain_tls_warn_days" BETWEEN 1 AND 365));--> statement-breakpoint
ALTER TABLE "domain_checks" ADD CONSTRAINT "domain_checks_intervals_check" CHECK (("domain_checks"."dns_interval_days" IS NULL OR "domain_checks"."dns_interval_days" BETWEEN 1 AND 365)
        AND ("domain_checks"."tls_interval_days" IS NULL OR "domain_checks"."tls_interval_days" BETWEEN 1 AND 365)
        AND ("domain_checks"."rdap_interval_days" IS NULL OR "domain_checks"."rdap_interval_days" BETWEEN 1 AND 365)
        AND ("domain_checks"."email_interval_days" IS NULL OR "domain_checks"."email_interval_days" BETWEEN 1 AND 365)
        AND ("domain_checks"."tls_warn_days" IS NULL OR "domain_checks"."tls_warn_days" BETWEEN 1 AND 365));--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_domain_intervals_check" CHECK ("instance_settings"."domain_dns_interval_days" BETWEEN 0 AND 365
        AND "instance_settings"."domain_tls_interval_days" BETWEEN 0 AND 365
        AND "instance_settings"."domain_rdap_interval_days" BETWEEN 0 AND 365
        AND "instance_settings"."domain_email_interval_days" BETWEEN 0 AND 365
        AND "instance_settings"."domain_tls_warn_days" BETWEEN 1 AND 365);