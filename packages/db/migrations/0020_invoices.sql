CREATE TABLE "invoice_counters" (
	"series" text PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_booking_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"draft" jsonb NOT NULL,
	"file_key" text,
	CONSTRAINT "invoices_root_booking_id_unique" UNIQUE("root_booking_id"),
	CONSTRAINT "invoices_kind_check" CHECK (kind in ('invoice','receipt'))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "tax_number" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "invoice_consent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_provider_id_number_idx" ON "invoices" USING btree ("provider_id","number");--> statement-breakpoint
CREATE INDEX "invoices_customer_id_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK (kind in ('profile-live','request-received','quote-received','booking-proposed','booking-accepted','booking-declined','booking-expired','payment-reminder','quote-expiring','request-expired','requests-ignored','pending-slot-requested','message-received','booking-paid','payment-received','payment-late-refunded','payout-setup-complete','customers-waiting','provider-available','refund-issued','job-finished','confirm-reminder','payment-released','was-job-done','booking-cancelled','no-show-reported','dispute-opened','dispute-decided','job-stopped','stop-amount-stated','additional-task-requested','review-requested','review-visible','provider-warning','invoice-ready'));