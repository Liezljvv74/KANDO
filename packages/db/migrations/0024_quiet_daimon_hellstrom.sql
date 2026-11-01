CREATE TABLE "quote_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"number" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"draft" jsonb NOT NULL,
	"file_key" text,
	CONSTRAINT "quote_documents_quote_id_unique" UNIQUE("quote_id")
);
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_status_check";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "time_proposed_by" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "time_proposed_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "time_proposed_duration_min" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "time_proposed_on_site" boolean;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "time_answer_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "duration_min" integer;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "on_site" boolean;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "address_street" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "address_postcode" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "address_city" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_documents_provider_id_number_idx" ON "quote_documents" USING btree ("provider_id","number");--> statement-breakpoint
CREATE INDEX "quote_documents_customer_id_idx" ON "quote_documents" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "bookings_awaiting_time_answer_by_idx" ON "bookings" USING btree ("answer_by") WHERE status = 'awaiting-time';--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_time_proposed_by_check" CHECK (time_proposed_by in ('provider','customer'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK (status in ('proposed','awaiting-time','awaiting-payment','confirmed','expired','declined','withdrawn','finished','completed','disputed','cancelled','stopped','refunded'));--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_duration_check" CHECK (duration_min > 0);