CREATE TABLE "help_search_cache" (
	"key" text NOT NULL,
	"lang" text NOT NULL,
	"model" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_search_cache_key_lang_model_pk" PRIMARY KEY("key","lang","model")
);
