CREATE TABLE "user_kb_collections" (
	"user_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_kb_collections_user_id_collection_id_pk" PRIMARY KEY("user_id","collection_id")
);
--> statement-breakpoint
ALTER TABLE "user_kb_collections" ADD CONSTRAINT "user_kb_collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_kb_collections" ADD CONSTRAINT "user_kb_collections_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_kb_collections_collection_idx" ON "user_kb_collections" USING btree ("collection_id");