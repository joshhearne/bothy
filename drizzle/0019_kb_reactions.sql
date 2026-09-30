CREATE TABLE "kb_favorites" (
	"reader_key" text NOT NULL,
	"article_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_favorites_reader_key_article_id_pk" PRIMARY KEY("reader_key","article_id")
);
--> statement-breakpoint
CREATE TABLE "kb_votes" (
	"reader_key" text NOT NULL,
	"article_id" uuid NOT NULL,
	"helpful" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_votes_reader_key_article_id_pk" PRIMARY KEY("reader_key","article_id")
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "kb_public_access_team" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "kb_public_access_aud" text;--> statement-breakpoint
ALTER TABLE "kb_favorites" ADD CONSTRAINT "kb_favorites_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_votes" ADD CONSTRAINT "kb_votes_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_favorites_article_idx" ON "kb_favorites" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "kb_votes_article_idx" ON "kb_votes" USING btree ("article_id");