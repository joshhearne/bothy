CREATE TABLE "company_sign_in_domains" (
	"company_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_sign_in_domains_company_id_domain_pk" PRIMARY KEY("company_id","domain")
);
--> statement-breakpoint
ALTER TABLE "company_sign_in_domains" ADD CONSTRAINT "company_sign_in_domains_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_sign_in_domains_domain_idx" ON "company_sign_in_domains" USING btree ("domain");