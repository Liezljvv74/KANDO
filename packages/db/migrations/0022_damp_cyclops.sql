CREATE INDEX "users_suspended_until_idx" ON "users" USING btree ("suspended_until") WHERE suspended_until IS NOT NULL;--> statement-breakpoint
CREATE INDEX "providers_location_gist" ON "providers" USING gist (("location"::geography));--> statement-breakpoint
CREATE INDEX "providers_suspended_until_idx" ON "providers" USING btree ("suspended_until") WHERE suspended_until IS NOT NULL;--> statement-breakpoint
CREATE INDEX "services_category_id_idx" ON "services" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "photos_owner_id_idx" ON "photos" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "private_files_owner_id_idx" ON "private_files" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "retained_records_delete_after_idx" ON "retained_records" USING btree ("delete_after");--> statement-breakpoint
CREATE INDEX "notifications_requests_ignored_idx" ON "notifications" USING btree ("user_id","created_at") WHERE kind = 'requests-ignored';--> statement-breakpoint
CREATE INDEX "bookings_service_id_idx" ON "bookings" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "bookings_quote_id_idx" ON "bookings" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "bookings_proposed_answer_by_idx" ON "bookings" USING btree ("answer_by") WHERE status = 'proposed';--> statement-breakpoint
CREATE INDEX "bookings_awaiting_pay_by_idx" ON "bookings" USING btree ("pay_by") WHERE status = 'awaiting-payment';--> statement-breakpoint
CREATE INDEX "bookings_finished_confirm_by_idx" ON "bookings" USING btree ("confirm_by") WHERE status = 'finished';--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_payment_ref_idx" ON "bookings" USING btree ("payment_ref");--> statement-breakpoint
CREATE INDEX "quotes_sent_expires_at_idx" ON "quotes" USING btree ("expires_at") WHERE status = 'sent';--> statement-breakpoint
CREATE INDEX "requests_service_id_idx" ON "requests" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "requests_parent_booking_id_idx" ON "requests" USING btree ("parent_booking_id");--> statement-breakpoint
CREATE INDEX "requests_open_answer_by_idx" ON "requests" USING btree ("answer_by") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "blocks_blocked_id_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "contact_attempts_user_id_created_at_idx" ON "contact_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_attempts_thread_id_idx" ON "contact_attempts" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "messages_sender_id_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "staff_flags_user_id_idx" ON "staff_flags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staff_flags_kind_ref_id_idx" ON "staff_flags" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "threads_customer_id_idx" ON "threads" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "threads_provider_id_idx" ON "threads" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_provider_id_created_at_idx" ON "ledger_entries" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "disputes_open_decide_by_idx" ON "disputes" USING btree ("decide_by") WHERE decided_at IS NULL;--> statement-breakpoint
CREATE INDEX "reviews_author_id_idx" ON "reviews" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "reviews_reveal_pending_idx" ON "reviews" USING btree ("visible_at") WHERE reveal_told_at IS NULL;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_price_check" CHECK (price >= 0);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_currency_check" CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_amount_check" CHECK (amount >= 0);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_commission_rate_check" CHECK (commission_rate >= 0 AND commission_rate < 1);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_stop_amount_check" CHECK (stop_amount >= 0 AND stop_amount <= amount);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_material_amount_check" CHECK (material_amount >= 0 AND material_amount <= amount);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_duration_check" CHECK (duration_min > 0);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_currency_check" CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_amount_check" CHECK (amount >= 0);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_duration_check" CHECK (duration_min > 0);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_version_check" CHECK (version >= 1);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_currency_check" CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_currency_check" CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "commission_invoices" ADD CONSTRAINT "commission_invoices_total_check" CHECK (total >= 0);--> statement-breakpoint
ALTER TABLE "commission_invoices" ADD CONSTRAINT "commission_invoices_currency_check" CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_check" CHECK (total >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_currency_check" CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint
DROP POLICY IF EXISTS app_insert ON translations;--> statement-breakpoint
DROP POLICY IF EXISTS app_insert ON translation_requests;--> statement-breakpoint
DROP POLICY IF EXISTS public_read ON translation_requests;--> statement-breakpoint
DROP FUNCTION IF EXISTS prune_translation_requests();
