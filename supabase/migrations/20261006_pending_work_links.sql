-- ═════════════════════════════════════════════════════════════════════════════
-- Item 23 — Pending Work ↔ Service linking, assignment, completion
--
--   1. pending_work_links: many-to-many pending item ↔ service record,
--      with a `resolves` flag (same pattern as maintenance_fulfillments)
--   2. pending_work: assigned_shop_id, assigned_to, reported_by;
--      identified_by → source; resolved_by_record_id migrated + dropped
--   3. sync_pending_status(): links drive status + completed_date
--   4. pending_work_open view recreated (adds assigned_shop_name)
--
-- PRE-FLIGHT — keep the old view definition for reference:
--   SELECT pg_get_viewdef('pending_work_open'::regclass, true);
--
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

-- View depends on pending_work columns — drop before ALTER (CLAUDE.md rule)
DROP VIEW IF EXISTS pending_work_open;


-- ── 1. pending_work_links ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pending_work_links (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_work_id    uuid        NOT NULL REFERENCES pending_work(id)    ON DELETE CASCADE,
  service_record_id  uuid        NOT NULL REFERENCES service_records(id) ON DELETE CASCADE,
  resolves           boolean     NOT NULL DEFAULT false,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pending_work_id, service_record_id)
);

CREATE INDEX IF NOT EXISTS idx_pwl_pending ON pending_work_links (pending_work_id);
CREATE INDEX IF NOT EXISTS idx_pwl_record  ON pending_work_links (service_record_id);

ALTER TABLE pending_work_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fam read"   ON pending_work_links;
DROP POLICY IF EXISTS "fam insert" ON pending_work_links;
DROP POLICY IF EXISTS "fam update" ON pending_work_links;
DROP POLICY IF EXISTS "fam delete" ON pending_work_links;
CREATE POLICY "fam read"   ON pending_work_links FOR SELECT TO authenticated USING (true);
CREATE POLICY "fam insert" ON pending_work_links FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fam update" ON pending_work_links FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- Link rows are removed during normal editing (unlinking) — members may delete
CREATE POLICY "fam delete" ON pending_work_links FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_audit ON pending_work_links;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON pending_work_links
  FOR EACH ROW EXECUTE FUNCTION audit_row();


-- ── 2. pending_work columns ──────────────────────────────────────────────────

ALTER TABLE pending_work
  ADD COLUMN IF NOT EXISTS assigned_shop_id uuid REFERENCES shops(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reported_by      uuid REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'pending_work'
               AND column_name = 'identified_by') THEN
    ALTER TABLE pending_work RENAME COLUMN identified_by TO source;
  END IF;
END $$;

UPDATE pending_work SET source = NULLIF(btrim(source), '') WHERE source IS DISTINCT FROM NULLIF(btrim(source), '');

-- Joe-reported rows (pre-date accounts); others stay NULL
UPDATE pending_work
SET    reported_by = (SELECT id FROM profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1)
WHERE  reported_by IS NULL AND source IN ('Joe', 'Self');

-- Carry over any old single links, then drop the column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'pending_work'
               AND column_name = 'resolved_by_record_id') THEN
    INSERT INTO pending_work_links (pending_work_id, service_record_id, resolves, notes)
    SELECT id, resolved_by_record_id, true, 'Migrated from resolved_by_record_id'
    FROM   pending_work WHERE resolved_by_record_id IS NOT NULL
    ON CONFLICT DO NOTHING;
    ALTER TABLE pending_work DROP COLUMN resolved_by_record_id;
  END IF;
END $$;


-- ── 3. Links drive status ────────────────────────────────────────────────────
--   any resolving link   → completed, completed_date = latest resolving record date
--   links, none resolve  → in_progress
--   no links left        → back to pending (only if links had moved it)
--   cancelled items are never touched

CREATE OR REPLACE FUNCTION public.sync_pending_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  pid        uuid;
  cur        pending_status;
  n_links    int;
  any_res    boolean;
  last_date  date;
BEGIN
  FOR pid IN
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.pending_work_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.pending_work_id END
    ]) AS x WHERE x IS NOT NULL
  LOOP
    SELECT status INTO cur FROM pending_work WHERE id = pid;
    CONTINUE WHEN cur IS NULL OR cur = 'cancelled';

    SELECT count(*), COALESCE(bool_or(l.resolves), false),
           max(sr.service_date) FILTER (WHERE l.resolves)
    INTO   n_links, any_res, last_date
    FROM   pending_work_links l
    JOIN   service_records sr ON sr.id = l.service_record_id
    WHERE  l.pending_work_id = pid;

    IF any_res THEN
      UPDATE pending_work
      SET    status = 'completed', completed_date = COALESCE(last_date, current_date)
      WHERE  id = pid
        AND  (status IS DISTINCT FROM 'completed'
              OR completed_date IS DISTINCT FROM COALESCE(last_date, current_date));
    ELSIF n_links > 0 THEN
      UPDATE pending_work SET status = 'in_progress', completed_date = NULL
      WHERE  id = pid AND status IN ('pending', 'completed');
    ELSE
      UPDATE pending_work SET status = 'pending', completed_date = NULL
      WHERE  id = pid AND status IN ('in_progress', 'completed');
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pending_status ON pending_work_links;
CREATE TRIGGER trg_sync_pending_status
  AFTER INSERT OR UPDATE OR DELETE ON pending_work_links
  FOR EACH ROW EXECUTE FUNCTION sync_pending_status();


-- ── 4. pending_work_open ─────────────────────────────────────────────────────

-- security_invoker: the view applies the caller's RLS (PG15+), not the owner's
CREATE VIEW pending_work_open WITH (security_invoker = true) AS
SELECT
  pw.*,
  v.name   AS vehicle_name,
  v.year,
  v.make,
  v.model,
  s.name   AS assigned_shop_name
FROM pending_work pw
JOIN vehicles v    ON v.id = pw.vehicle_id
LEFT JOIN shops s  ON s.id = pw.assigned_shop_id
WHERE pw.status NOT IN ('completed', 'cancelled');

GRANT SELECT ON pending_work_open TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
--   SELECT status, count(*) FROM pending_work GROUP BY 1;
--   SELECT source, reported_by IS NOT NULL AS has_reporter, count(*)
--   FROM pending_work GROUP BY 1, 2 ORDER BY 3 DESC;
--   SELECT count(*) FROM pending_work_open;
-- ═════════════════════════════════════════════════════════════════════════════
