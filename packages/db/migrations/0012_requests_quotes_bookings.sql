CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"provider_id" uuid NOT NULL,
	"service_id" uuid,
	"quote_id" uuid,
	"source" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"on_site" boolean DEFAULT true NOT NULL,
	"address_street" text,
	"address_postcode" text,
	"address_city" text,
	"note" text,
	"answer_by" timestamp with time zone,
	"pay_by" timestamp with time zone,
	"counter_by" text,
	"reminded_half_at" timestamp with time zone,
	"reminded_last_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_source_check" CHECK (source in ('quote','direct')),
	CONSTRAINT "bookings_status_check" CHECK (status in ('proposed','awaiting-payment','expired','declined','withdrawn')),
	CONSTRAINT "bookings_counter_by_check" CHECK (counter_by in ('provider','customer'))
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"scope" text NOT NULL,
	"start_at" timestamp with time zone,
	"duration_min" integer,
	"status" text DEFAULT 'sent' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_status_check" CHECK (status in ('sent','accepted','superseded','expired','declined'))
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"provider_id" uuid NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"preferred_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"answer_by" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_status_check" CHECK (status in ('open','quoted','booked','expired','withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_provider_id_status_idx" ON "bookings" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "bookings_start_at_idx" ON "bookings" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "bookings_customer_id_idx" ON "bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "quotes_provider_id_status_idx" ON "quotes" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "quotes_start_at_idx" ON "quotes" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "quotes_request_id_idx" ON "quotes" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "requests_provider_id_status_idx" ON "requests" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "requests_customer_id_idx" ON "requests" USING btree ("customer_id");