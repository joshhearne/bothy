CREATE TABLE "instance_branding" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"name" text,
	"accent" text,
	"logo_key" text,
	"logo_mime" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "instance_branding_singleton" CHECK ("instance_branding"."id")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "accent" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_mime" text;--> statement-breakpoint
ALTER TABLE "instance_branding" ADD CONSTRAINT "instance_branding_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;