-- Policies reading providers.suspended / photo_id would block the column drops; applyRls() recreates them after migrate.
DROP POLICY IF EXISTS public_read ON "providers";--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON "services";--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON "provider_references";--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON "photos";--> statement-breakpoint
DROP FUNCTION IF EXISTS set_provider_photo(uuid);--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "notifications_kind_check" CHECK (kind in ('profile-live'))
);
--> statement-breakpoint
ALTER TABLE "providers" DROP CONSTRAINT "providers_photo_id_photos_id_fk";
--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Nobody uses the app yet: profile photos are rebuilt as the person's own picture (no provider), so old rows go.
DELETE FROM "photos" WHERE kind = 'profile';--> statement-breakpoint
CREATE UNIQUE INDEX "photos_one_profile_idx" ON "photos" USING btree ("owner_id") WHERE kind = 'profile';--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address_street" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address_postcode" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address_city" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address_country" text;--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN "display_name";--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN "suspended";--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN "photo_id";--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_profile_provider_check" CHECK ((kind = 'profile') = (provider_id IS NULL));
