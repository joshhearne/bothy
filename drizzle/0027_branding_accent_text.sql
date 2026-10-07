UPDATE "instance_branding" SET
  "accent" = "alt_accent", "alt_accent" = "accent",
  "logo_key" = "alt_logo_key", "alt_logo_key" = "logo_key",
  "logo_mime" = "alt_logo_mime", "alt_logo_mime" = "logo_mime",
  "scheme" = 'light'
WHERE "scheme" = 'dark';--> statement-breakpoint
ALTER TABLE "instance_branding" ADD COLUMN "accent_text" text;--> statement-breakpoint
ALTER TABLE "instance_branding" ADD COLUMN "alt_accent_text" text;