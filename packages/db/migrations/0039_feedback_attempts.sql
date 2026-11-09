CREATE TABLE "feedback_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_attempts" ADD CONSTRAINT "feedback_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_attempts_user_idx" ON "feedback_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_attempts_ip_idx" ON "feedback_attempts" USING btree ("ip_hash","created_at");