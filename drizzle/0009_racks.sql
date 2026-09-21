CREATE TABLE "rack_mounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rack_id" uuid NOT NULL,
	"position_u" integer NOT NULL,
	"height_u" integer DEFAULT 1 NOT NULL,
	"face" text DEFAULT 'front' NOT NULL,
	"document_id" uuid,
	"label" text,
	"doc_type_id" uuid,
	CONSTRAINT "rack_mounts_height_check" CHECK ("rack_mounts"."height_u" BETWEEN 1 AND 20),
	CONSTRAINT "rack_mounts_face_check" CHECK ("rack_mounts"."face" IN ('front','rear','both')),
	CONSTRAINT "rack_mounts_identity_check" CHECK ("rack_mounts"."document_id" IS NOT NULL OR "rack_mounts"."label" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "rack_type_colors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type_id" uuid NOT NULL,
	"company_id" uuid,
	"color" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "racks" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"total_u" integer DEFAULT 42 NOT NULL,
	"has_rear" boolean DEFAULT false NOT NULL,
	"numbering" text DEFAULT 'bottom_up' NOT NULL,
	CONSTRAINT "racks_total_u_check" CHECK ("racks"."total_u" BETWEEN 1 AND 60),
	CONSTRAINT "racks_numbering_check" CHECK ("racks"."numbering" IN ('bottom_up','top_down'))
);
--> statement-breakpoint
ALTER TABLE "rack_mounts" ADD CONSTRAINT "rack_mounts_rack_id_racks_document_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."racks"("document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rack_mounts" ADD CONSTRAINT "rack_mounts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rack_mounts" ADD CONSTRAINT "rack_mounts_doc_type_id_doc_types_id_fk" FOREIGN KEY ("doc_type_id") REFERENCES "public"."doc_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rack_type_colors" ADD CONSTRAINT "rack_type_colors_doc_type_id_doc_types_id_fk" FOREIGN KEY ("doc_type_id") REFERENCES "public"."doc_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rack_type_colors" ADD CONSTRAINT "rack_type_colors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "racks" ADD CONSTRAINT "racks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rack_mounts_rack_idx" ON "rack_mounts" USING btree ("rack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rack_type_colors_global_idx" ON "rack_type_colors" USING btree ("doc_type_id") WHERE "rack_type_colors"."company_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rack_type_colors_company_idx" ON "rack_type_colors" USING btree ("doc_type_id","company_id") WHERE "rack_type_colors"."company_id" IS NOT NULL;