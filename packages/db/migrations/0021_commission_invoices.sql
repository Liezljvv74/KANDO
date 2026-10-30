CREATE TABLE "commission_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"month" text NOT NULL,
	"number" text NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"currency" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"draft" jsonb NOT NULL,
	"file_key" text,
	CONSTRAINT "commission_invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "commission_invoices_month_check" CHECK (month ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
CREATE UNIQUE INDEX "commission_invoices_provider_id_month_idx" ON "commission_invoices" USING btree ("provider_id","month");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK (kind in ('profile-live','request-received','quote-received','booking-proposed','booking-accepted','booking-declined','booking-expired','payment-reminder','quote-expiring','request-expired','requests-ignored','pending-slot-requested','message-received','booking-paid','payment-received','payment-late-refunded','payout-setup-complete','customers-waiting','provider-available','refund-issued','job-finished','confirm-reminder','payment-released','was-job-done','booking-cancelled','no-show-reported','dispute-opened','dispute-decided','job-stopped','stop-amount-stated','additional-task-requested','review-requested','review-visible','provider-warning','invoice-ready','commission-invoice-ready'));