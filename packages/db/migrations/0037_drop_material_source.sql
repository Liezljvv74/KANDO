ALTER TABLE "bookings" DROP CONSTRAINT "bookings_source_check";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_material_amount_check";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "request_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "material_amount";