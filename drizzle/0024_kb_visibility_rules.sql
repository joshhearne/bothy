CREATE TABLE "kb_hidden_categories" (
	"collection_id" uuid NOT NULL,
	"category" text NOT NULL,
	CONSTRAINT "kb_hidden_categories_collection_id_category_pk" PRIMARY KEY("collection_id","category")
);
--> statement-breakpoint
CREATE TABLE "kb_hide_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"is_regex" boolean DEFAULT false NOT NULL,
	"match_articles" boolean DEFAULT false NOT NULL,
	"match_categories" boolean DEFAULT false NOT NULL,
	"match_files" boolean DEFAULT false NOT NULL,
	"regex" text NOT NULL,
	"file_regex" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "kb_articles" ADD COLUMN "hidden_by" text;--> statement-breakpoint
UPDATE "kb_articles" SET "hidden_by" = 'manual' WHERE "public_hidden";--> statement-breakpoint
ALTER TABLE "kb_hidden_categories" ADD CONSTRAINT "kb_hidden_categories_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_hide_rules" ADD CONSTRAINT "kb_hide_rules_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_hide_rules" ADD CONSTRAINT "kb_hide_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_hide_rules_collection_idx" ON "kb_hide_rules" USING btree ("collection_id");--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_hidden_by_check" CHECK ("kb_articles"."hidden_by" IN ('manual','rule','category'));