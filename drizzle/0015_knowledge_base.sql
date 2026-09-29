CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"external_id" text,
	"source_path" text,
	"source_url" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'markdown' NOT NULL,
	"source_type" text NOT NULL,
	"category" text,
	"subcategory" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"date_created" timestamp with time zone,
	"date_modified" timestamp with time zone,
	"extraction" text DEFAULT 'ok' NOT NULL,
	"content_hash" text NOT NULL,
	"archived_at" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_articles_collection_source_key" UNIQUE("collection_id","source_key"),
	CONSTRAINT "kb_articles_format_check" CHECK ("kb_articles"."format" IN ('markdown','text')),
	CONSTRAINT "kb_articles_extraction_check" CHECK ("kb_articles"."extraction" IN ('ok','unextracted'))
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"article_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"heading" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"search_vec" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', heading), 'B') || setweight(to_tsvector('english', content), 'D')) STORED,
	CONSTRAINT "kb_chunks_article_ordinal" UNIQUE("article_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "kb_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"open_to_restricted" boolean DEFAULT false NOT NULL,
	"mcp_enabled" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_collections_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "kb_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"interval_hours" integer DEFAULT 168 NOT NULL,
	"max_pages" integer DEFAULT 500 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_connectors_kind_check" CHECK ("kb_connectors"."kind" IN ('sitemap','prefix')),
	CONSTRAINT "kb_connectors_interval_check" CHECK ("kb_connectors"."interval_hours" BETWEEN 1 AND 8760),
	CONSTRAINT "kb_connectors_max_pages_check" CHECK ("kb_connectors"."max_pages" BETWEEN 1 AND 20000)
);
--> statement-breakpoint
CREATE TABLE "kb_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"source" text NOT NULL,
	"connector_id" uuid,
	"filename" text,
	"status" text DEFAULT 'uploading' NOT NULL,
	"expected_bytes" bigint,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"unextracted" integer DEFAULT 0 NOT NULL,
	"ignored" integer DEFAULT 0 NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"used_manifest" boolean DEFAULT false NOT NULL,
	"error" text,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "kb_imports_source_check" CHECK ("kb_imports"."source" IN ('upload','connector')),
	CONSTRAINT "kb_imports_status_check" CHECK ("kb_imports"."status" IN ('uploading','running','done','failed'))
);
--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_collections" ADD CONSTRAINT "kb_collections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_connectors" ADD CONSTRAINT "kb_connectors_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_imports" ADD CONSTRAINT "kb_imports_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_imports" ADD CONSTRAINT "kb_imports_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_articles_category_idx" ON "kb_articles" USING btree ("collection_id","category","subcategory");--> statement-breakpoint
CREATE INDEX "kb_chunks_search_idx" ON "kb_chunks" USING gin ("search_vec");--> statement-breakpoint
CREATE INDEX "kb_chunks_collection_idx" ON "kb_chunks" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "kb_connectors_due_idx" ON "kb_connectors" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "kb_imports_collection_idx" ON "kb_imports" USING btree ("collection_id","started_at");