-- ═════════════════════════════════════════════════════════════════════════════
-- Family access (roadmap items 25 + user half of 10)
--
--   1. is_admin() helper
--   2. audit_log + generic audit_row() trigger on every user-data table
--   3. deletion_requests (members request, admin approves by deleting)
--   4. Standard RLS: members add/edit, only admin deletes
--      (parts, mileage_log, maintenance_fulfillments stay member-deletable
--       because normal editing removes them)
--   5. Roadmap guard: members can't change status / priority / completion
--   6. Profiles guard: only an admin can change anyone's role
--   7. last_seen_changes_at + mark_changes_seen() for the "Changes" counter
--
-- PRE-FLIGHT — run this first and save the output (record of the old policies
-- that section 4 replaces):
--
--   SELECT tablename, policyname, cmd, roles, qual, with_check
--   FROM   pg_policies WHERE schemaname = 'public'
--   ORDER  BY tablename, policyname;
--
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════


-- ── 1. is_admin() ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE ALL     ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- ── 2. deletion_requests (created before audit_row, which references it) ────

CREATE TABLE IF NOT EXISTS deletion_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name    text        NOT NULL,
  row_id        text        NOT NULL,
  label         text,
  vehicle_id    uuid        REFERENCES vehicles(id) ON DELETE SET NULL,
  link          text,
  reason        text        NOT NULL,
  requested_by  uuid        NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected')),
  resolved_by   uuid        REFERENCES profiles(id),
  resolved_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deletion_requests_pending
  ON deletion_requests (table_name, row_id) WHERE status = 'pending';

ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dr read"   ON deletion_requests;
DROP POLICY IF EXISTS "dr insert" ON deletion_requests;
DROP POLICY IF EXISTS "dr update" ON deletion_requests;
CREATE POLICY "dr read"   ON deletion_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "dr insert" ON deletion_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() AND status = 'pending');
CREATE POLICY "dr update" ON deletion_requests FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());


-- ── 3. audit_log + audit_row() ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id              bigserial   PRIMARY KEY,
  table_name      text        NOT NULL,
  op              text        NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id          text,
  vehicle_id      uuid,
  changed_by      uuid        DEFAULT auth.uid(),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  old_data        jsonb,
  new_data        jsonb,
  changed_fields  text[]
);

CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON audit_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_vehicle    ON audit_log (vehicle_id);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit read" ON audit_log;
CREATE POLICY "audit read" ON audit_log FOR SELECT TO authenticated USING (true);
-- No write policies: only audit_row() (SECURITY DEFINER) writes.

CREATE OR REPLACE FUNCTION public.audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o       jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  n       jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  r       jsonb := COALESCE(n, o);
  fields  text[];
  veh     uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(key ORDER BY key) INTO fields
    FROM   jsonb_each(n)
    WHERE  key NOT IN ('updated_at', 'last_seen_changes_at')
      AND  n -> key IS DISTINCT FROM o -> key;
    IF fields IS NULL THEN
      RETURN NULL;                       -- only bookkeeping columns changed
    END IF;
  END IF;

  veh := CASE
           WHEN TG_TABLE_NAME = 'vehicles' THEN (r ->> 'id')::uuid
           WHEN r ? 'vehicle_id'           THEN NULLIF(r ->> 'vehicle_id', '')::uuid
         END;

  INSERT INTO audit_log (table_name, op, row_id, vehicle_id, old_data, new_data, changed_fields)
  VALUES (TG_TABLE_NAME, TG_OP, r ->> 'id', veh, o, n, fields);

  -- Approving a deletion request = actually deleting the row
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME <> 'deletion_requests' THEN
    UPDATE deletion_requests
    SET    status = 'approved', resolved_by = auth.uid(), resolved_at = now()
    WHERE  table_name = TG_TABLE_NAME AND row_id = (o ->> 'id') AND status = 'pending';
  END IF;

  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicles', 'service_visits', 'service_records', 'parts', 'mileage_log',
    'inspections', 'inspection_fulfillments', 'maintenance_schedule',
    'maintenance_fulfillments', 'pending_work', 'shops', 'documents',
    'modifications', 'vehicle_notes', 'known_specs', 'diagnostic_codes',
    'registrations', 'roadmap_items', 'profiles', 'deletion_requests'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION audit_row()', t);
  END LOOP;
END $$;


-- ── 4. Standard RLS: add/edit for all, delete for admin ─────────────────────
-- Replaces every existing policy on these tables (see PRE-FLIGHT above).
-- profiles is deliberately excluded (its own policies + guard in section 6).

DO $$
DECLARE
  t   text;
  pol record;
  admin_only_delete text[] := ARRAY[
    'vehicles', 'service_visits', 'service_records', 'inspections',
    'inspection_fulfillments', 'maintenance_schedule', 'pending_work', 'shops', 'documents',
    'modifications', 'vehicle_notes', 'known_specs', 'diagnostic_codes',
    'registrations', 'roadmap_items'
  ];
  member_delete text[] := ARRAY[
    'parts', 'mileage_log', 'maintenance_fulfillments'
  ];
BEGIN
  FOREACH t IN ARRAY admin_only_delete || member_delete LOOP
    FOR pol IN SELECT policyname FROM pg_policies
               WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON %I', pol.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "fam read"   ON %I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "fam insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "fam update" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format(
      'CREATE POLICY "fam delete" ON %I FOR DELETE TO authenticated USING (%s)',
      t, CASE WHEN t = ANY (member_delete) THEN 'true' ELSE 'is_admin()' END);
  END LOOP;
END $$;


-- ── 5. Roadmap guard ─────────────────────────────────────────────────────────
-- "trg_roadmap_a_…" sorts before trg_roadmap_priority_status /
-- trg_roadmap_status_priority, so it sees the member's raw change first.

CREATE OR REPLACE FUNCTION public.roadmap_member_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status         := 'new';
    NEW.priority       := 'medium';
    NEW.date_completed := NULL;
  ELSIF NEW.status         IS DISTINCT FROM OLD.status
     OR NEW.priority       IS DISTINCT FROM OLD.priority
     OR NEW.date_completed IS DISTINCT FROM OLD.date_completed THEN
    RAISE EXCEPTION 'Only an admin can change roadmap status, priority or completion date';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roadmap_a_member_guard ON roadmap_items;
CREATE TRIGGER trg_roadmap_a_member_guard
  BEFORE INSERT OR UPDATE ON roadmap_items
  FOR EACH ROW EXECUTE FUNCTION roadmap_member_guard();


-- ── 6. Profiles guard: role changes are admin-only ──────────────────────────
-- auth.uid() IS NULL = service role (admin-users Edge Function) — allowed.

CREATE OR REPLACE FUNCTION public.profiles_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_admin() THEN
    IF TG_OP = 'INSERT' AND NEW.role IS DISTINCT FROM 'member' THEN
      NEW.role := 'member';
    ELSIF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only an admin can change roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_role_guard ON profiles;
CREATE TRIGGER trg_profiles_role_guard
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_role_guard();


-- ── 7. "Changes" counter support ─────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_changes_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_changes_seen()
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles SET last_seen_changes_at = now()
  WHERE  id = auth.uid()
  RETURNING last_seen_changes_at;
$$;

REVOKE ALL     ON FUNCTION public.mark_changes_seen() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_changes_seen() TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
--   SELECT tablename, policyname, cmd, qual FROM pg_policies
--   WHERE schemaname = 'public' ORDER BY tablename, policyname;
--   SELECT is_admin();                                   -- true for Joe
--   SELECT * FROM audit_log ORDER BY id DESC LIMIT 5;    -- after any edit
-- ═════════════════════════════════════════════════════════════════════════════
