CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"opened_by" text,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decide_by" timestamp with time zone NOT NULL,
	"decision" text,
	"provider_share" numeric(10, 2),
	"decision_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "disputes_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "disputes_opened_by_check" CHECK (opened_by in ('customer','provider')),
	CONSTRAINT "disputes_reason_check" CHECK (reason in ('problem','no-show-objection','no-response','stop-disagreed','chargeback')),
	CONSTRAINT "disputes_decision_check" CHECK (decision in ('full-payout','partial','full-refund')),
	CONSTRAINT "disputes_opened_by_needed_check" CHECK (reason not in ('problem','no-show-objection') OR opened_by IS NOT NULL),
	CONSTRAINT "disputes_decided_check" CHECK ((decision IS NULL AND decided_at IS NULL AND decision_reason IS NULL AND provider_share IS NULL) OR (decision IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL AND provider_share IS NOT NULL)),
	CONSTRAINT "disputes_provider_share_check" CHECK (provider_share >= 0 AND (decision <> 'full-refund' OR provider_share = 0))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"author_role" text NOT NULL,
	"stars" integer NOT NULL,
	"text" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"visible_at" timestamp with time zone,
	"reveal_told_at" timestamp with time zone,
	CONSTRAINT "reviews_author_role_check" CHECK (author_role in ('customer','provider')),
	CONSTRAINT "reviews_stars_check" CHECK (stars between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_status_check";--> statement-breakpoint
ALTER TABLE "staff_flags" DROP CONSTRAINT "staff_flags_kind_check";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "parent_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "confirm_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "confirm_reminders_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "asked_done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "late_cancel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "no_show" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "no_show_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stopped_by" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stop_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stop_note" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stop_stated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "material_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "parent_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_id_author_id_idx" ON "reviews" USING btree ("booking_id","author_id");--> statement-breakpoint
CREATE INDEX "reviews_subject_id_idx" ON "reviews" USING btree ("subject_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_parent_booking_id_bookings_id_fk" FOREIGN KEY ("parent_booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_parent_booking_id_bookings_id_fk" FOREIGN KEY ("parent_booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_parent_booking_id_idx" ON "bookings" USING btree ("parent_booking_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK (kind in ('profile-live','request-received','quote-received','booking-proposed','booking-accepted','booking-declined','booking-expired','payment-reminder','quote-expiring','request-expired','requests-ignored','pending-slot-requested','message-received','booking-paid','payment-received','payment-late-refunded','payout-setup-complete','customers-waiting','provider-available','refund-issued','job-finished','confirm-reminder','payment-released','was-job-done','booking-cancelled','no-show-reported','dispute-opened','dispute-decided','job-stopped','stop-amount-stated','additional-task-requested','review-requested','review-visible','provider-warning'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_check" CHECK (cancelled_by in ('customer','provider'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_show_check" CHECK (no_show in ('customer','provider'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_stopped_by_check" CHECK (stopped_by in ('customer','provider'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK (status in ('proposed','awaiting-payment','confirmed','expired','declined','withdrawn','finished','completed','disputed','cancelled','stopped','refunded'));--> statement-breakpoint
ALTER TABLE "staff_flags" ADD CONSTRAINT "staff_flags_kind_check" CHECK (kind in ('contact-attempts','message-reported','chargeback','refund-failed','payment-unprocessed','ignored-requests','provider-no-shows','dispute-overdue'));