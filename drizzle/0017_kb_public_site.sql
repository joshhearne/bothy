ALTER TABLE "instance_settings" ADD COLUMN "kb_public_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "kb_public_addresses" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "kb_public_url" text;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD COLUMN "public_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_collections" ADD COLUMN "public_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_kb_public_mode_check" CHECK ("instance_settings"."kb_public_mode" IN ('off','addresses','open'));