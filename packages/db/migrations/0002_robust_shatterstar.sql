CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"requirement" text NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_status_check" CHECK (status in ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "provider_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"client_name" text NOT NULL,
	"description" text NOT NULL,
	"year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"type" text NOT NULL,
	"display_name" text NOT NULL,
	"business_name" text,
	"public_name" text,
	"slug" text,
	"bio" text,
	"strengths" text,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"experience" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"base_postcode" text,
	"location" geometry(Point,4326),
	"service_radius_km" integer DEFAULT 25 NOT NULL,
	"works_remotely" boolean DEFAULT false NOT NULL,
	"impressum" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"legal_status" text,
	"vat_id" text,
	"photo_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_owner_id_unique" UNIQUE("owner_id"),
	CONSTRAINT "providers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "providers_type_check" CHECK (type in ('private','business')),
	CONSTRAINT "providers_status_check" CHECK (status in ('draft','published')),
	CONSTRAINT "providers_radius_check" CHECK (service_radius_km between 1 and 200),
	CONSTRAINT "providers_legal_status_check" CHECK (legal_status in ('private','kleinunternehmer','business'))
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price_type" text NOT NULL,
	"price" numeric(10, 2),
	"currency" text DEFAULT 'EUR' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_price_type_check" CHECK (price_type in ('fixed','hourly','from','on-request'))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_references" ADD CONSTRAINT "provider_references_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;