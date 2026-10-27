CREATE INDEX "documents_owner_id_idx" ON "documents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "provider_references_provider_id_idx" ON "provider_references" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "services_provider_id_idx" ON "services" USING btree ("provider_id");