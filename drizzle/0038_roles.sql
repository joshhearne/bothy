CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "roles" ("key", "name", "description", "permissions", "builtin") VALUES
  ('admin', 'Administrator', 'Everything, including the administration area.', '{hierarchy.manage,documents.edit,doc_types.manage,secrets.fields,kb.write,admin.area}', true),
  ('tech', 'Technician', 'Creates and edits documents, adds local fields, promotes fields, adds dropdown options.', '{documents.edit,secrets.fields}', true),
  ('readonly', 'Read-only', 'Views what their companies allow.', '{}', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;