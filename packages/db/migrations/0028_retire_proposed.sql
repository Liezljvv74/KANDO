-- The proposed booking status is gone (MVP step 1.6b part 2): no live data, so the leftovers are deleted, not converted.
-- A quote-born one gives the job back first, as the trigger bookings_reopen_request does when a booking ends unagreed: its quote is open
-- again while it is valid (else expired) and its request is quoted again, so nothing stays booked without a booking.
-- Their threads and messages go with them (ON DELETE cascade). A proposed booking was never paid, so it has no dispute, review or ledger row.
CREATE TEMP TABLE "_m28_proposed" AS SELECT "id", "quote_id", "request_id" FROM "bookings" WHERE "status" = 'proposed' AND "quote_id" IS NOT NULL AND "parent_booking_id" IS NULL;--> statement-breakpoint
UPDATE "quotes" SET "status" = CASE WHEN "expires_at" > now() THEN 'sent' ELSE 'expired' END WHERE "status" = 'accepted' AND "id" IN (SELECT "quote_id" FROM "_m28_proposed");--> statement-breakpoint
UPDATE "requests" SET "status" = 'quoted', "updated_at" = now() WHERE "status" = 'booked' AND "id" IN (SELECT "request_id" FROM "_m28_proposed");--> statement-breakpoint
DROP TABLE "_m28_proposed";--> statement-breakpoint
DELETE FROM "bookings" WHERE "status" = 'proposed';--> statement-breakpoint
DELETE FROM "notifications" WHERE "kind" IN ('booking-proposed','booking-declined','pending-slot-requested');--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_counter_by_check";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_status_check";--> statement-breakpoint
DROP INDEX "bookings_proposed_answer_by_idx";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "counter_by";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK (kind in ('profile-live','request-received','quote-received','booking-accepted','booking-expired','payment-reminder','quote-expiring','request-expired','requests-ignored','message-received','booking-paid','payment-received','payment-late-refunded','payout-setup-complete','customers-waiting','provider-available','refund-issued','job-finished','confirm-reminder','payment-released','was-job-done','booking-cancelled','no-show-reported','dispute-opened','dispute-decided','job-stopped','stop-amount-stated','additional-task-requested','review-requested','review-visible','provider-warning','invoice-ready','commission-invoice-ready','request-withdrawn','request-declined','request-reopened','request-updated','time-proposed','time-to-confirm','quote-confirmed'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK (status in ('awaiting-time','awaiting-payment','confirmed','expired','declined','withdrawn','finished','completed','disputed','cancelled','stopped','refunded'));