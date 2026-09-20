CREATE TABLE "domain_checks" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"dns" boolean DEFAULT false NOT NULL,
	"tls" boolean DEFAULT false NOT NULL,
	"rdap" boolean DEFAULT false NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"checked_at" timestamp with time zone,
	"checked_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fields" ADD COLUMN "domain_role" text;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD CONSTRAINT "domain_checks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_checks" ADD CONSTRAINT "domain_checks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_domain_role_check" CHECK ("fields"."domain_role" IS NULL OR "fields"."domain_role" IN ('domain','expiry','registrar','dns_host'));--> statement-breakpoint
/*
 * The starter pack's Domain/DNS record already has these fields; naming their
 * roles is what lets a lookup find the domain and offer to fill the rest in.
 */
UPDATE fields f SET domain_role = CASE f.label
  WHEN 'Domain' THEN 'domain'
  WHEN 'Expiration' THEN 'expiry'
  WHEN 'Registrar' THEN 'registrar'
  WHEN 'DNS Host' THEN 'dns_host'
END
FROM doc_types dt
WHERE dt.id = f.doc_type_id
  AND dt.name = 'Domain/DNS'
  AND f.label IN ('Domain', 'Expiration', 'Registrar', 'DNS Host')
  AND f.domain_role IS NULL;
