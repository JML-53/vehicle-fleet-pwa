-- ═════════════════════════════════════════════════════════════════════════════
-- Item 9 group — document pipeline (9, 9.3, 9.4, 9.5, 24)
--
--   1. service_visits.title (item 24) + backfill: existing visits get the
--      concatenation of their service-item titles (Joe's rule); new visits
--      get an AI-written title from the document parser.
--   2. Source-document links (item 9.5): diagnostic_codes.document_id and
--      pending_work.source_document_id. (Visits already have
--      source_document_id; inspection_fulfillments already have document_id;
--      service records reach their document through their visit.)
--
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

-- Views that select pending_work.* must be recreated after the ALTER
DROP VIEW IF EXISTS pending_work_open;


-- ── 1. Visit titles ──────────────────────────────────────────────────────────

ALTER TABLE service_visits ADD COLUMN IF NOT EXISTS title text;

UPDATE service_visits sv
SET    title = left(t.joined, 120)
FROM (
  SELECT visit_id, string_agg(title, ' · ' ORDER BY created_at, title) AS joined
  FROM   service_records
  WHERE  visit_id IS NOT NULL AND btrim(coalesce(title, '')) <> ''
  GROUP  BY visit_id
) t
WHERE  t.visit_id = sv.id AND sv.title IS NULL;


-- ── 2. Source-document links ─────────────────────────────────────────────────

ALTER TABLE diagnostic_codes
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES documents(id) ON DELETE SET NULL;

ALTER TABLE pending_work
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dc_document ON diagnostic_codes (document_id);
CREATE INDEX IF NOT EXISTS idx_pw_document ON pending_work (source_document_id);


-- ── pending_work_open (recreated to pick up the new column) ──────────────────

CREATE VIEW pending_work_open WITH (security_invoker = true) AS
SELECT pw.*, v.name AS vehicle_name, v.year, v.make, v.model, s.name AS assigned_shop_name
FROM pending_work pw
JOIN vehicles v   ON v.id = pw.vehicle_id
LEFT JOIN shops s ON s.id = pw.assigned_shop_id
WHERE pw.status NOT IN ('completed', 'cancelled');

GRANT SELECT ON pending_work_open TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
--   SELECT visit_date, title FROM service_visits ORDER BY visit_date DESC LIMIT 10;
-- ═════════════════════════════════════════════════════════════════════════════
