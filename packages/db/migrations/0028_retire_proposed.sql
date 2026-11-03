-- The proposed booking status is gone (MVP step 1.6b part 2): no live data, so the leftovers are deleted, not converted.
-- Their threads and messages go with them (ON DELETE cascade). A proposed booking was never paid, so it has no dispute, review or ledger row.
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