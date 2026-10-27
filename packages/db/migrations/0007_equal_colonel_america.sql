CREATE TABLE "page_texts" (
	"page_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"title" text NOT NULL,
	"body_markdown" text DEFAULT '' NOT NULL,
	CONSTRAINT "page_texts_page_id_lang_pk" PRIMARY KEY("page_id","lang")
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"kind" text DEFAULT 'page' NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "pages_slug_unique" UNIQUE("slug"),
	CONSTRAINT "pages_kind_check" CHECK ("pages"."kind" in ('page','post'))
);
--> statement-breakpoint
ALTER TABLE "page_texts" ADD CONSTRAINT "page_texts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;