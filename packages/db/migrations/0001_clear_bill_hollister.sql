CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"language" text DEFAULT 'de' NOT NULL,
	"name" text,
	"is_provider" boolean DEFAULT false NOT NULL,
	"staff_role" text,
	"suspended_until" timestamp with time zone,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_staff_role_check" CHECK (staff_role in ('admin','reviewer'))
);
