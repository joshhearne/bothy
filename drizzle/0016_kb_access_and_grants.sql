CREATE TABLE "api_key_kb_collections" (
	"api_key_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_kb_collections_api_key_id_collection_id_pk" PRIMARY KEY("api_key_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "kb_collection_companies" (
	"collection_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	CONSTRAINT "kb_collection_companies_collection_id_company_id_pk" PRIMARY KEY("collection_id","company_id")
);
--> statement-breakpoint
ALTER TABLE "kb_collections" ADD COLUMN "all_companies" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_kb_collections" ADD CONSTRAINT "api_key_kb_collections_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_kb_collections" ADD CONSTRAINT "api_key_kb_collections_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_collection_companies" ADD CONSTRAINT "kb_collection_companies_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_collection_companies" ADD CONSTRAINT "kb_collection_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_kb_collections_collection_idx" ON "api_key_kb_collections" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "kb_collection_companies_company_idx" ON "kb_collection_companies" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "kb_collections" DROP COLUMN "open_to_restricted";