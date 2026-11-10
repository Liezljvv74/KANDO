-- the six group names are also HELP_GROUPS (packages/contract/src/help.ts) and the CHECK in packages/db/src/schema/reference.ts: change all three together
CREATE TABLE "help_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"sort" integer NOT NULL,
	"group" text NOT NULL,
	"title_de" text NOT NULL,
	"body_de" text NOT NULL,
	"title_en" text NOT NULL,
	"body_en" text NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_topics_slug_unique" UNIQUE("slug"),
	CONSTRAINT "help_topics_group_check" CHECK ("help_topics"."group" IN ('using-the-app', 'booking-and-paying', 'providers', 'money-and-fees', 'safety-and-rules', 'your-data')),
	CONSTRAINT "help_topics_text_check" CHECK (btrim("help_topics"."title_de") <> '' AND btrim("help_topics"."body_de") <> '' AND btrim("help_topics"."title_en") <> '' AND btrim("help_topics"."body_en") <> '')
);
