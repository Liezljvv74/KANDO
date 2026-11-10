ALTER TABLE "help_topics" ADD COLUMN "embedding_de" jsonb;--> statement-breakpoint
ALTER TABLE "help_topics" ADD COLUMN "embedding_en" jsonb;--> statement-breakpoint
ALTER TABLE "help_topics" ADD COLUMN "embedding_model" text;