ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "category_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "requests" r SET "category_id" = s."category_id" FROM "services" s WHERE s."id" = r."service_id" AND r."category_id" IS NULL;
