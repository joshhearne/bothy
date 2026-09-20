ALTER TABLE "companies" ADD COLUMN "brand_scheme" text DEFAULT 'light' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "alt_accent" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "alt_logo_key" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "alt_logo_mime" text;--> statement-breakpoint
ALTER TABLE "instance_branding" ADD COLUMN "scheme" text DEFAULT 'light' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_branding" ADD COLUMN "alt_accent" text;--> statement-breakpoint
ALTER TABLE "instance_branding" ADD COLUMN "alt_logo_key" text;--> statement-breakpoint
ALTER TABLE "instance_branding" ADD COLUMN "alt_logo_mime" text;--> statement-breakpoint
ALTER TABLE "instance_branding" ADD CONSTRAINT "instance_branding_scheme_check" CHECK ("instance_branding"."scheme" IN ('light','dark'));