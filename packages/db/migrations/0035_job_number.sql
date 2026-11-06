CREATE SEQUENCE IF NOT EXISTS job_number_seq START WITH 1000 MINVALUE 1000;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "job_number" integer;--> statement-breakpoint
UPDATE "requests" r SET "job_number" = n.num FROM (SELECT id, (row_number() OVER (ORDER BY created_at, id) + 999)::integer AS num FROM "requests") n WHERE r.id = n.id AND r."job_number" IS NULL;--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "job_number" SET DEFAULT nextval('job_number_seq');--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "job_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_job_number_unique" UNIQUE("job_number");--> statement-breakpoint
SELECT setval('job_number_seq', GREATEST((SELECT max("job_number") FROM "requests"), 999), true);
