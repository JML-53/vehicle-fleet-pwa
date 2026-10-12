-- ═════════════════════════════════════════════════════════════════════════════
-- Item 32 phase 1 — Workflow: sources, sessions, dependencies, rank, due date
--
--   1. pending_work.rank (order in a person's Later list) + due_date
--   2. work_sessions (trip to the shop / DIY day) + work_session_items
--      (planned items and their close-out outcome) + service_visits.work_session_id
--   3. pending_work_sources (where work was reported — one object shared by every
--      item it produced) + pending_work_source_links (many:many)
--   4. pending_work_deps ("waiting on": after | only_if_fails), no loops
--   5. Compatibility: until phase 2 moves the app over, the old columns
--      (source_inspection_fulfillment_id, source_document_id, source text) are
--      mirrored into sources/links by a trigger, so today's code keeps working
--   6. close_repairs_on_pass reads the links (and the old column, belt and braces)
--   7. Backfill: sources + links for every existing item; due dates for open
--      items from failed inspections (re-test deadline)
--   8. pending_work_open recreated to pick up the new columns
--
-- Source kinds use a CHECK list, not an enum, so adding one later is a one-line
-- change (item 10: enum values can't be dropped).
--
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

-- View depends on pending_work columns — drop before ALTER (CLAUDE.md rule)
DROP VIEW IF EXISTS pending_work_open;


-- ── 1. pending_work: rank + due date ─────────────────────────────────────────

ALTER TABLE pending_work
  ADD COLUMN IF NOT EXISTS rank     int4,
  ADD COLUMN IF NOT EXISTS due_date date;

CREATE INDEX IF NOT EXISTS idx_pw_due ON pending_work (due_date) WHERE due_date IS NOT NULL;


-- ── 2. Work sessions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  planned_date  date,                                   -- NULL = not dated yet
  assigned_to   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  shop_id       uuid        REFERENCES shops(id)    ON DELETE SET NULL,  -- NULL = DIY
  status        text        NOT NULL DEFAULT 'planned'
                            CHECK (status IN ('planned', 'closed', 'cancelled')),
  notes         text,
  created_by    uuid        REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  closed_at     timestamptz,
  closed_by     uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ws_status_date ON work_sessions (status, planned_date);
CREATE INDEX IF NOT EXISTS idx_ws_assigned    ON work_sessions (assigned_to);

CREATE TABLE IF NOT EXISTS work_session_items (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid        NOT NULL REFERENCES work_sessions(id) ON DELETE CASCADE,
  pending_work_id    uuid        NOT NULL REFERENCES pending_work(id)  ON DELETE CASCADE,
  position           int4        NOT NULL DEFAULT 0,
  -- NULL while planned; set at close-out
  outcome            text        CHECK (outcome IN ('done', 'partial', 'not_done', 'dropped')),
  outcome_note       text,
  service_record_id  uuid        REFERENCES service_records(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, pending_work_id)
);

CREATE INDEX IF NOT EXISTS idx_wsi_session ON work_session_items (session_id);
-- An item is in at most ONE planned session at a time (its history is kept)
CREATE UNIQUE INDEX IF NOT EXISTS uq_wsi_one_planned
  ON work_session_items (pending_work_id) WHERE outcome IS NULL;

ALTER TABLE service_visits
  ADD COLUMN IF NOT EXISTS work_session_id uuid REFERENCES work_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sv_work_session ON service_visits (work_session_id)
  WHERE work_session_id IS NOT NULL;

-- Items can only be added to a planned session
CREATE OR REPLACE FUNCTION public.work_session_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (SELECT status FROM work_sessions WHERE id = NEW.session_id) IS DISTINCT FROM 'planned' THEN
    RAISE EXCEPTION 'This session is already closed or cancelled — add the item to a planned session instead';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wsi_guard ON work_session_items;
CREATE TRIGGER trg_wsi_guard
  BEFORE INSERT ON work_session_items
  FOR EACH ROW EXECUTE FUNCTION work_session_items_guard();

-- Closing needs an outcome for every item (nothing dropped silently);
-- cancelling marks the remaining items "not done" so they return to their lanes
CREATE OR REPLACE FUNCTION public.work_session_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n_open int;
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    SELECT count(*) INTO n_open FROM work_session_items
    WHERE session_id = NEW.id AND outcome IS NULL;
    IF n_open > 0 THEN
      RAISE EXCEPTION 'Every planned item needs an outcome before the session can be closed (% left)', n_open;
    END IF;
    NEW.closed_at := COALESCE(NEW.closed_at, now());
    NEW.closed_by := COALESCE(NEW.closed_by, auth.uid());
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE work_session_items
    SET    outcome = 'not_done', outcome_note = COALESCE(outcome_note, 'Session cancelled')
    WHERE  session_id = NEW.id AND outcome IS NULL;
    NEW.closed_at := COALESCE(NEW.closed_at, now());
    NEW.closed_by := COALESCE(NEW.closed_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ws_status_guard ON work_sessions;
CREATE TRIGGER trg_ws_status_guard
  BEFORE UPDATE OF status ON work_sessions
  FOR EACH ROW EXECUTE FUNCTION work_session_status_guard();

DROP TRIGGER IF EXISTS trg_ws_updated_at ON work_sessions;
CREATE TRIGGER trg_ws_updated_at
  BEFORE UPDATE ON work_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── 3. Sources ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pending_work_sources (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id                 uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind                       text        NOT NULL
                             CHECK (kind IN ('inspection', 'document', 'service_visit', 'work_session', 'note')),
  inspection_fulfillment_id  uuid        REFERENCES inspection_fulfillments(id) ON DELETE CASCADE,
  document_id                uuid        REFERENCES documents(id)               ON DELETE CASCADE,
  service_visit_id           uuid        REFERENCES service_visits(id)          ON DELETE CASCADE,
  work_session_id            uuid        REFERENCES work_sessions(id)           ON DELETE CASCADE,
  label                      text        NOT NULL,   -- "Failed safety inspection 09/24/2026", "Teri", "NTB 05/18/2026"
  reported_by                uuid        REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  reported_date              date,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  -- exactly the link that matches the kind (a note has none)
  CONSTRAINT pws_kind_link CHECK (
        (kind = 'inspection')    = (inspection_fulfillment_id IS NOT NULL)
    AND (kind = 'document')      = (document_id IS NOT NULL)
    AND (kind = 'service_visit') = (service_visit_id IS NOT NULL)
    AND (kind = 'work_session')  = (work_session_id IS NOT NULL))
);

-- The same inspection / document / visit is always the same source
CREATE UNIQUE INDEX IF NOT EXISTS uq_pws_inspection ON pending_work_sources (inspection_fulfillment_id) WHERE inspection_fulfillment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pws_document   ON pending_work_sources (document_id)               WHERE document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pws_visit      ON pending_work_sources (service_visit_id)          WHERE service_visit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pws_session    ON pending_work_sources (work_session_id, vehicle_id) WHERE work_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pws_note       ON pending_work_sources (vehicle_id, label)        WHERE kind = 'note';
CREATE INDEX IF NOT EXISTS idx_pws_vehicle ON pending_work_sources (vehicle_id);

CREATE TABLE IF NOT EXISTS pending_work_source_links (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_work_id  uuid        NOT NULL REFERENCES pending_work(id)         ON DELETE CASCADE,
  source_id        uuid        NOT NULL REFERENCES pending_work_sources(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pending_work_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_pwsl_source ON pending_work_source_links (source_id);

-- Find-or-create a source (used by the backfill, the compatibility trigger and,
-- in phase 2, the split / close-out flows)
CREATE OR REPLACE FUNCTION public.pending_source_id(
  p_kind text, p_vehicle_id uuid, p_ref uuid, p_label text, p_date date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sid uuid;
BEGIN
  FOR i IN 1..2 LOOP
    SELECT id INTO sid FROM pending_work_sources
    WHERE  kind = p_kind
      AND  CASE p_kind
             WHEN 'inspection'    THEN inspection_fulfillment_id = p_ref
             WHEN 'document'      THEN document_id = p_ref
             WHEN 'service_visit' THEN service_visit_id = p_ref
             WHEN 'work_session'  THEN work_session_id = p_ref AND vehicle_id = p_vehicle_id
             ELSE vehicle_id = p_vehicle_id AND label = p_label
           END
    LIMIT 1;
    EXIT WHEN sid IS NOT NULL OR i = 2;

    INSERT INTO pending_work_sources (
      vehicle_id, kind, inspection_fulfillment_id, document_id, service_visit_id,
      work_session_id, label, reported_date)
    VALUES (
      p_vehicle_id, p_kind,
      CASE WHEN p_kind = 'inspection'    THEN p_ref END,
      CASE WHEN p_kind = 'document'      THEN p_ref END,
      CASE WHEN p_kind = 'service_visit' THEN p_ref END,
      CASE WHEN p_kind = 'work_session'  THEN p_ref END,
      p_label, p_date)
    ON CONFLICT DO NOTHING
    RETURNING id INTO sid;
    EXIT WHEN sid IS NOT NULL;   -- else someone else created it: look again
  END LOOP;
  RETURN sid;
END;
$$;

-- Labels shared by the trigger and the backfill
CREATE OR REPLACE FUNCTION public.inspection_source_label(p_fulfillment_id uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT format('%s %s inspection %s',
           CASE f.result WHEN 'fail' THEN 'Failed' WHEN 'pass' THEN 'Passed'
                         ELSE initcap(COALESCE(f.result::text, '')) END,
           i.inspection_type, to_char(f.inspection_date, 'MM/DD/YYYY'))
  FROM inspection_fulfillments f JOIN inspections i ON i.id = f.inspection_id
  WHERE f.id = p_fulfillment_id
$$;

CREATE OR REPLACE FUNCTION public.document_source_label(p_document_id uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN length(t) > 60 THEN rtrim(left(t, 57)) || '…' ELSE t END
         || COALESCE(' ' || to_char(d.document_date, 'MM/DD/YYYY'), '')
  FROM documents d
  CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(btrim(d.description), ''), d.filename, 'Document') AS t) x
  WHERE d.id = p_document_id
$$;

-- Text sources that just repeat a linked inspection/document aren't separate notes
CREATE OR REPLACE FUNCTION public.is_note_source(p_text text, p_has_link boolean)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT NULLIF(btrim(p_text), '') IS NOT NULL
     AND btrim(p_text) <> 'From uploaded document'
     AND NOT (p_has_link AND btrim(p_text) ~* '^(failed|passed) (safety|emissions) inspection')
$$;


-- ── 4. Dependencies ("waiting on") ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pending_work_deps (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_work_id  uuid        NOT NULL REFERENCES pending_work(id) ON DELETE CASCADE,  -- waits…
  blocked_by_id    uuid        NOT NULL REFERENCES pending_work(id) ON DELETE CASCADE,  -- …on this
  kind             text        NOT NULL DEFAULT 'after' CHECK (kind IN ('after', 'only_if_fails')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pending_work_id, blocked_by_id),
  CHECK (pending_work_id <> blocked_by_id)
);

CREATE INDEX IF NOT EXISTS idx_pwd_blocked_by ON pending_work_deps (blocked_by_id);

CREATE OR REPLACE FUNCTION public.pending_deps_no_loop()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Walk up from the blocker; reaching the waiting item means a loop
  IF EXISTS (
    WITH RECURSIVE up(id) AS (
      SELECT NEW.blocked_by_id
      UNION
      SELECT d.blocked_by_id FROM pending_work_deps d JOIN up ON d.pending_work_id = up.id
    )
    SELECT 1 FROM up WHERE id = NEW.pending_work_id
  ) THEN
    RAISE EXCEPTION 'That would make a loop: the other item already waits on this one';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pwd_no_loop ON pending_work_deps;
CREATE TRIGGER trg_pwd_no_loop
  BEFORE INSERT OR UPDATE ON pending_work_deps
  FOR EACH ROW EXECUTE FUNCTION pending_deps_no_loop();


-- ── RLS + change log for the new tables ──────────────────────────────────────
-- Primary rows (sessions, sources): admin deletes. Link rows: members may delete.

DO $$
DECLARE
  t text;
  admin_only_delete text[] := ARRAY['work_sessions', 'pending_work_sources'];
  member_delete     text[] := ARRAY['work_session_items', 'pending_work_source_links', 'pending_work_deps'];
BEGIN
  FOREACH t IN ARRAY admin_only_delete || member_delete LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "fam read"   ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "fam insert" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "fam update" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "fam delete" ON %I', t);
    EXECUTE format('CREATE POLICY "fam read"   ON %I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "fam insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "fam update" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "fam delete" ON %I FOR DELETE TO authenticated USING (%s)',
                   t, CASE WHEN t = ANY (member_delete) THEN 'true' ELSE 'is_admin()' END);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION audit_row()', t);
  END LOOP;
END $$;


-- ── 5. Compatibility: old source columns → sources/links ─────────────────────
-- Removed in a later cleanup once phase 2 writes sources directly.

CREATE OR REPLACE FUNCTION public.sync_pending_sources_from_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  insp_doc uuid;
BEGIN
  -- Inspection
  IF TG_OP = 'UPDATE' AND OLD.source_inspection_fulfillment_id IS NOT NULL
     AND OLD.source_inspection_fulfillment_id IS DISTINCT FROM NEW.source_inspection_fulfillment_id THEN
    DELETE FROM pending_work_source_links l USING pending_work_sources s
    WHERE  l.source_id = s.id AND l.pending_work_id = NEW.id
      AND  s.inspection_fulfillment_id = OLD.source_inspection_fulfillment_id;
  END IF;
  IF NEW.source_inspection_fulfillment_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.source_inspection_fulfillment_id IS DISTINCT FROM NEW.source_inspection_fulfillment_id) THEN
    INSERT INTO pending_work_source_links (pending_work_id, source_id)
    SELECT NEW.id, pending_source_id('inspection', NEW.vehicle_id, f.id,
                                     inspection_source_label(f.id), f.inspection_date)
    FROM   inspection_fulfillments f WHERE f.id = NEW.source_inspection_fulfillment_id
    ON CONFLICT DO NOTHING;
  END IF;

  -- Document (skipped when it is the linked inspection's own document)
  SELECT document_id INTO insp_doc FROM inspection_fulfillments WHERE id = NEW.source_inspection_fulfillment_id;
  IF TG_OP = 'UPDATE' AND OLD.source_document_id IS NOT NULL
     AND OLD.source_document_id IS DISTINCT FROM NEW.source_document_id THEN
    DELETE FROM pending_work_source_links l USING pending_work_sources s
    WHERE  l.source_id = s.id AND l.pending_work_id = NEW.id AND s.document_id = OLD.source_document_id;
  END IF;
  IF NEW.source_document_id IS NOT NULL AND NEW.source_document_id IS DISTINCT FROM insp_doc
     AND (TG_OP = 'INSERT' OR OLD.source_document_id IS DISTINCT FROM NEW.source_document_id
          OR OLD.source_inspection_fulfillment_id IS DISTINCT FROM NEW.source_inspection_fulfillment_id) THEN
    INSERT INTO pending_work_source_links (pending_work_id, source_id)
    SELECT NEW.id, pending_source_id('document', NEW.vehicle_id, d.id,
                                     document_source_label(d.id), d.document_date)
    FROM   documents d WHERE d.id = NEW.source_document_id
    ON CONFLICT DO NOTHING;
  END IF;

  -- Free-text source → a note source per vehicle + label
  IF TG_OP = 'UPDATE' AND OLD.source IS DISTINCT FROM NEW.source AND OLD.source IS NOT NULL THEN
    DELETE FROM pending_work_source_links l USING pending_work_sources s
    WHERE  l.source_id = s.id AND l.pending_work_id = NEW.id
      AND  s.kind = 'note' AND s.label = btrim(OLD.source);
  END IF;
  IF is_note_source(NEW.source, NEW.source_inspection_fulfillment_id IS NOT NULL OR NEW.source_document_id IS NOT NULL)
     AND (TG_OP = 'INSERT' OR OLD.source IS DISTINCT FROM NEW.source) THEN
    INSERT INTO pending_work_source_links (pending_work_id, source_id)
    VALUES (NEW.id, pending_source_id('note', NEW.vehicle_id, NULL, btrim(NEW.source), NEW.identified_date))
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pw_sources_compat ON pending_work;
CREATE TRIGGER trg_pw_sources_compat
  AFTER INSERT OR UPDATE OF source_inspection_fulfillment_id, source_document_id, source ON pending_work
  FOR EACH ROW EXECUTE FUNCTION sync_pending_sources_from_columns();


-- ── 6. A passing re-test closes every item linked to the failed inspection ───

CREATE OR REPLACE FUNCTION public.close_repairs_on_pass()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  pw_id uuid;
BEGIN
  IF NEW.result IS DISTINCT FROM 'pass' THEN
    RETURN NULL;
  END IF;

  FOR pw_id IN
    WITH earlier AS (
      SELECT f.id FROM inspection_fulfillments f
      WHERE  f.inspection_id = NEW.inspection_id
        AND  f.id <> NEW.id
        AND  f.inspection_date <= NEW.inspection_date
    )
    SELECT pw.id
    FROM   pending_work pw
    WHERE  pw.status NOT IN ('completed', 'cancelled')
      AND (  pw.source_inspection_fulfillment_id IN (SELECT id FROM earlier)
          OR EXISTS (SELECT 1 FROM pending_work_source_links l
                     JOIN pending_work_sources s ON s.id = l.source_id
                     WHERE l.pending_work_id = pw.id
                       AND s.inspection_fulfillment_id IN (SELECT id FROM earlier)))
  LOOP
    IF NEW.service_record_id IS NOT NULL THEN
      -- Link the passing record as "resolves"; sync_pending_status completes it
      INSERT INTO pending_work_links (pending_work_id, service_record_id, resolves, notes)
      VALUES (pw_id, NEW.service_record_id, true, 'Closed by passing re-inspection')
      ON CONFLICT (pending_work_id, service_record_id) DO UPDATE SET resolves = true;
    ELSE
      UPDATE pending_work SET status = 'completed', completed_date = NEW.inspection_date
      WHERE  id = pw_id;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
-- (trigger trg_close_repairs_on_pass already points at this function)


-- ── 7. Backfill ──────────────────────────────────────────────────────────────

-- Inspection sources
INSERT INTO pending_work_source_links (pending_work_id, source_id)
SELECT pw.id, pending_source_id('inspection', pw.vehicle_id, f.id,
                                inspection_source_label(f.id), f.inspection_date)
FROM   pending_work pw
JOIN   inspection_fulfillments f ON f.id = pw.source_inspection_fulfillment_id
ON CONFLICT DO NOTHING;

-- Document sources (not the inspection's own document)
INSERT INTO pending_work_source_links (pending_work_id, source_id)
SELECT pw.id, pending_source_id('document', pw.vehicle_id, d.id,
                                document_source_label(d.id), d.document_date)
FROM   pending_work pw
JOIN   documents d ON d.id = pw.source_document_id
LEFT JOIN inspection_fulfillments f ON f.id = pw.source_inspection_fulfillment_id
WHERE  d.id IS DISTINCT FROM f.document_id
ON CONFLICT DO NOTHING;

-- Free-text sources → notes
INSERT INTO pending_work_source_links (pending_work_id, source_id)
SELECT pw.id, pending_source_id('note', pw.vehicle_id, NULL, btrim(pw.source), pw.identified_date)
FROM   pending_work pw
WHERE  is_note_source(pw.source, pw.source_inspection_fulfillment_id IS NOT NULL OR pw.source_document_id IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Due date = re-test deadline for open items from a failed inspection
UPDATE pending_work pw
SET    due_date = COALESCE(f.expiry_date, f.inspection_date + COALESCE(i.grace_days, 14))
FROM   inspection_fulfillments f
JOIN   inspections i ON i.id = f.inspection_id
WHERE  f.id = pw.source_inspection_fulfillment_id
  AND  f.result = 'fail'
  AND  pw.due_date IS NULL
  AND  pw.status NOT IN ('completed', 'cancelled');


-- ── 8. pending_work_open (recreated to pick up rank, due_date) ───────────────

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
--   SELECT kind, count(*) FROM pending_work_sources GROUP BY 1;
--   SELECT count(*) FROM pending_work pw WHERE NOT EXISTS
--     (SELECT 1 FROM pending_work_source_links l WHERE l.pending_work_id = pw.id);  -- items with no source
--   SELECT title, due_date FROM pending_work WHERE due_date IS NOT NULL;
--   Test: supabase/scripts/20261015_test_workflow_schema.sql (rolls itself back)
-- ═════════════════════════════════════════════════════════════════════════════
