DROP INDEX "quotes_request_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_request_id_version_idx" ON "quotes" USING btree ("request_id","version");