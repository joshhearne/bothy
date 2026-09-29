CREATE TABLE "kb_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"source_path" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_hash" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_images_collection_path" UNIQUE("collection_id","source_path")
);
--> statement-breakpoint
ALTER TABLE "kb_imports" ADD COLUMN "images" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_images" ADD CONSTRAINT "kb_images_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_images_lookup_idx" ON "kb_images" USING btree ("collection_id",lower("source_path"));