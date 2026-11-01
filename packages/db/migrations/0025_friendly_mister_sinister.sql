ALTER TABLE "quotes" ADD COLUMN "proposed_other_time" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "revised_at" timestamp with time zone;