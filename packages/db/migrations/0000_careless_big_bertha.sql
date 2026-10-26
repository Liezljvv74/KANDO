CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"country" text DEFAULT 'DE' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"required_documents" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "category_texts" (
	"category_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "category_texts_category_id_lang_pk" PRIMARY KEY("category_id","lang")
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"code" text PRIMARY KEY NOT NULL,
	"name_de" text NOT NULL,
	"name_en" text NOT NULL,
	"postcode_pattern" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"minor_units" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postcodes" (
	"country" text NOT NULL,
	"code" text NOT NULL,
	"place" text NOT NULL,
	"state" text NOT NULL,
	"location" geometry(Point,4326) NOT NULL,
	CONSTRAINT "postcodes_country_code_pk" PRIMARY KEY("country","code")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_country_countries_code_fk" FOREIGN KEY ("country") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_texts" ADD CONSTRAINT "category_texts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcodes" ADD CONSTRAINT "postcodes_country_countries_code_fk" FOREIGN KEY ("country") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "postcodes_location_gist" ON "postcodes" USING gist (("location"::geography));
--> statement-breakpoint
INSERT INTO "countries" ("code", "name_de", "name_en", "postcode_pattern") VALUES ('DE', 'Deutschland', 'Germany', '^\d{5}$');--> statement-breakpoint
INSERT INTO "currencies" ("code", "minor_units") VALUES ('EUR', 2);
