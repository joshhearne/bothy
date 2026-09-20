CREATE TABLE "api_key_companies" (
	"api_key_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_companies_api_key_id_company_id_pk" PRIMARY KEY("api_key_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "user_companies" (
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_companies_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "all_companies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "all_companies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_companies" ADD CONSTRAINT "api_key_companies_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_companies" ADD CONSTRAINT "api_key_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_companies_company_idx" ON "api_key_companies" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "user_companies_company_idx" ON "user_companies" USING btree ("company_id");--> statement-breakpoint
-- An existing install had no per-company access, so everyone who is already
-- here keeps seeing everything. Only rows created from now on default to
-- "nothing until granted".
UPDATE "users" SET "all_companies" = true;--> statement-breakpoint
UPDATE "api_keys" SET "all_companies" = true;
