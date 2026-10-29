CREATE TABLE "availability_watches" (
	"customer_id" text NOT NULL,
	"provider_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "availability_watches_customer_id_provider_id_pk" PRIMARY KEY("customer_id","provider_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"gateway_ref" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_entries_kind_check" CHECK (kind in ('charge','refund','transfer','commission')),
	CONSTRAINT "ledger_entries_amount_check" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_status_check";--> statement-breakpoint
ALTER TABLE "staff_flags" DROP CONSTRAINT "staff_flags_kind_check";--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "payouts_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "commission_rate" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_ref" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "checkout_ref" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
-- Hand-written backfill (existing rows, before the new checks): an accepted booking's acceptance time was its last
-- update; one awaiting payment without a deadline (none expected) lapses at the next sweep; quote bookings get their request.
UPDATE "bookings" SET "accepted_at" = "updated_at" WHERE "status" = 'awaiting-payment';--> statement-breakpoint
UPDATE "bookings" SET "pay_by" = "updated_at" WHERE "status" = 'awaiting-payment' AND "pay_by" IS NULL;--> statement-breakpoint
UPDATE "bookings" b SET "request_id" = q."request_id" FROM "quotes" q WHERE q."id" = b."quote_id";--> statement-breakpoint
ALTER TABLE "availability_watches" ADD CONSTRAINT "availability_watches_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_watches" ADD CONSTRAINT "availability_watches_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_watches_provider_id_idx" ON "availability_watches" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_booking_id_idx" ON "ledger_entries" USING btree ("booking_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_request_id_idx" ON "bookings" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_stripe_account_id_unique" UNIQUE("stripe_account_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK (kind in ('profile-live','request-received','quote-received','booking-proposed','booking-accepted','booking-declined','booking-expired','payment-reminder','quote-expiring','request-expired','requests-ignored','pending-slot-requested','message-received','booking-paid','payment-received','payment-late-refunded','payout-setup-complete','customers-waiting','provider-available','refund-issued'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pay_by_check" CHECK (status <> 'awaiting-payment' OR pay_by IS NOT NULL);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_accepted_at_check" CHECK (status <> 'awaiting-payment' OR accepted_at IS NOT NULL);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK (status in ('proposed','awaiting-payment','confirmed','expired','declined','withdrawn'));--> statement-breakpoint
ALTER TABLE "staff_flags" ADD CONSTRAINT "staff_flags_kind_check" CHECK (kind in ('contact-attempts','message-reported','chargeback'));