CREATE TABLE "staff_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"flag_id" uuid,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_access_log_outcome_check" CHECK (outcome in ('allowed','denied'))
);
