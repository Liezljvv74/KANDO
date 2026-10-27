-- Same text as packages/db/src/rls.ts (applyRls also runs it after every migrate).
-- I-1: set_provider_published also refuses when the owner is suspended (users.suspended_until IS NOT NULL).
-- M-8: the eligibility functions answer only for a visible provider or the caller's own.
-- CREATE OR REPLACE keeps the grants; on an empty database applyRls adds them right after the migrations.
-- Bodies are not checked here: app_current_user_id() is created by applyRls, after the migrations.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_provider_published(p_published boolean, p_slug_base text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE r providers; s text; n int := 1;
    BEGIN
      SELECT * INTO r FROM providers WHERE owner_id = app_current_user_id() FOR UPDATE;
      IF NOT FOUND THEN RETURN false; END IF;
      IF p_published AND (r.suspended OR EXISTS (SELECT 1 FROM users u WHERE u.id = r.owner_id AND u.suspended_until IS NOT NULL)) THEN
        RETURN false;
      END IF;
      IF p_published AND r.slug IS NULL THEN
        s := p_slug_base;
        WHILE EXISTS (SELECT 1 FROM providers WHERE slug = s) LOOP n := n + 1; s := p_slug_base || '-' || n; END LOOP;
        UPDATE providers SET slug = s WHERE id = r.id;
      END IF;
      UPDATE providers SET status = CASE WHEN p_published THEN 'published' ELSE 'draft' END, updated_at = now() WHERE id = r.id;
      RETURN true;
    END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION offerable_service_ids(p_provider_id uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT s.id FROM services s
      JOIN categories c ON c.id = s.category_id
      JOIN providers p ON p.id = s.provider_id
      WHERE s.provider_id = p_provider_id
        AND ((p.status = 'published' AND NOT p.suspended) OR p.owner_id = app_current_user_id())
        AND NOT EXISTS (
          SELECT 1 FROM unnest(c.required_documents) AS r(requirement)
          WHERE NOT EXISTS (
            SELECT 1 FROM documents d WHERE d.owner_id = p.owner_id AND d.requirement = r.requirement AND d.status = 'approved'
          )
        )
      ORDER BY s.created_at, s.id $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION missing_requirements(p_provider_id uuid, p_service_id uuid) RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT coalesce(array_agg(r.requirement ORDER BY r.requirement), '{}') FROM services s
      JOIN categories c ON c.id = s.category_id
      JOIN providers p ON p.id = s.provider_id
      CROSS JOIN LATERAL unnest(c.required_documents) AS r(requirement)
      WHERE s.id = p_service_id AND s.provider_id = p_provider_id
        AND ((p.status = 'published' AND NOT p.suspended) OR p.owner_id = app_current_user_id())
        AND NOT EXISTS (
          SELECT 1 FROM documents d WHERE d.owner_id = p.owner_id AND d.requirement = r.requirement AND d.status = 'approved'
        ) $$;
