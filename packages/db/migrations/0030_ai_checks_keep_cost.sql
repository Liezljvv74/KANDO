ALTER TABLE "document_ai_checks" DROP CONSTRAINT "document_ai_checks_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "document_ai_checks" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document_ai_checks" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "document_ai_checks" ADD CONSTRAINT "document_ai_checks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ai_checks" ADD CONSTRAINT "document_ai_checks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_ai_checks_owner_idx" ON "document_ai_checks" USING btree ("owner_id","created_at");
--> statement-breakpoint
UPDATE "document_ai_checks" c SET "owner_id" = d."owner_id" FROM "documents" d WHERE d."id" = c."document_id";--> statement-breakpoint
-- A deleted document keeps only the cost record: verdict, confidence and reason go with it.
CREATE OR REPLACE FUNCTION document_ai_checks_clear() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE document_ai_checks SET verdict = NULL, confidence = NULL, explanation = NULL WHERE document_id = OLD.id;
  RETURN OLD;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS documents_ai_checks_clear ON "documents";--> statement-breakpoint
CREATE TRIGGER documents_ai_checks_clear BEFORE DELETE ON "documents" FOR EACH ROW EXECUTE FUNCTION document_ai_checks_clear();
