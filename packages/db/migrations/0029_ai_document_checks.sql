CREATE TABLE "document_ai_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"verdict" text,
	"confidence" real,
	"explanation" text,
	"model" text NOT NULL,
	"sampled" boolean DEFAULT false NOT NULL,
	"decision" text,
	"failure" text,
	"cost_eur" numeric(10, 6) DEFAULT '0' NOT NULL,
	"staff_decision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "document_ai_checks_verdict_check" CHECK (verdict is null or verdict in ('ok','problem')),
	CONSTRAINT "document_ai_checks_decision_check" CHECK (decision is null or decision in ('auto-approved','sent-to-staff')),
	CONSTRAINT "document_ai_checks_staff_decision_check" CHECK (staff_decision is null or staff_decision in ('approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "image_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_ai_checks" ADD CONSTRAINT "document_ai_checks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_ai_checks_document_id_idx" ON "document_ai_checks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_ai_checks_created_at_idx" ON "document_ai_checks" USING btree ("created_at");