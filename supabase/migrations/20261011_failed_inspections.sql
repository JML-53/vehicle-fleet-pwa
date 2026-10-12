-- ═════════════════════════════════════════════════════════════════════════════
-- Item 28 — Failed inspections
--
--   1. inspections.grace_days (re-test window after a fail; per vehicle/type,
--      editable). Defaults: safety 15 (VA rejection sticker), emissions 14
--      (free re-test window).
--   2. pending_work.source_inspection_fulfillment_id — the failed inspection a
--      "fix it" item came from (a reference, NOT a pending_work_links row:
--      the failure identified the work, it didn't do it)
--   3. inspection_status view: result-aware. Latest result = fail →
--      expiry_status 'failed', next_due_date = re-test-by date,
--      retest_overdue flag.
--   4. Trigger: a later PASS for the same vehicle/type closes its open
--      "fix it" items (links the passing record as resolves → item completes)
--   5. Backfill: "fix it" items for the 04 Suburban 2026-09-19 failures
--
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

-- Views over these tables are recreated below (CLAUDE.md: drop before ALTER)
DROP VIEW IF EXISTS inspection_status;
DROP VIEW IF EXISTS pending_work_open;


-- ── 1. Grace period ──────────────────────────────────────────────────────────

ALTER TABLE inspections ADD COLUMN IF NOT EXISTS grace_days int4;
UPDATE inspections SET grace_days = CASE inspection_type WHEN 'safety' THEN 15 ELSE 14 END
WHERE  grace_days IS NULL;


-- ── 2. Pending work ← failed inspection ──────────────────────────────────────

ALTER TABLE pending_work
  ADD COLUMN IF NOT EXISTS source_inspection_fulfillment_id uuid
    REFERENCES inspection_fulfillments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pw_source_inspection
  ON pending_work (source_inspection_fulfillment_id);


-- ── 3. inspection_status (result-aware) ──────────────────────────────────────

CREATE VIEW inspection_status WITH (security_invoker = true) AS
WITH latest AS (
  SELECT
    i.id, i.vehicle_id, i.inspection_type, i.interval_months, i.grace_days,
    inf.id AS fulfillment_id, inf.inspection_date, inf.expiry_date, inf.result,
    inf.report_number, inf.shop_id, inf.document_id, inf.mileage_at_inspection,
    inf.service_record_id,
    CASE
      WHEN inf.inspection_date IS NULL THEN NULL
      -- Failed: re-test-by date (explicit expiry_date wins, else date + grace)
      WHEN inf.result = 'fail' THEN
        COALESCE(inf.expiry_date, inf.inspection_date + COALESCE(i.grace_days, 14))
      -- Passed (or conditional): VA end-of-month rule unless expiry given
      ELSE COALESCE(
        inf.expiry_date,
        (date_trunc('month', inf.inspection_date + (i.interval_months || ' months')::interval)
          + interval '1 month - 1 day')::date)
    END AS due_date
  FROM inspections i
  LEFT JOIN LATERAL (
    SELECT * FROM inspection_fulfillments
    WHERE  inspection_id = i.id
    ORDER  BY inspection_date DESC, created_at DESC
    LIMIT  1
  ) inf ON true
)
SELECT
  l.id, l.vehicle_id, l.inspection_type, l.interval_months, l.grace_days,
  v.name AS vehicle_name, v.year, v.make, v.model, v.current_plate,
  l.fulfillment_id, l.inspection_date, l.expiry_date, l.result, l.report_number,
  l.shop_id, l.document_id, l.mileage_at_inspection, l.service_record_id,
  l.due_date AS next_due_date,
  CASE
    WHEN l.inspection_date IS NULL                      THEN 'unknown'
    WHEN l.result = 'fail'                              THEN 'failed'
    WHEN l.due_date < CURRENT_DATE                      THEN 'expired'
    WHEN l.due_date < CURRENT_DATE + interval '60 days' THEN 'due_soon'
    ELSE 'current'
  END AS expiry_status,
  (l.result = 'fail' AND l.due_date < CURRENT_DATE)   AS retest_overdue,
  l.due_date - CURRENT_DATE                            AS days_until_expiry
FROM latest l
JOIN vehicles v ON v.id = l.vehicle_id;

GRANT SELECT ON inspection_status TO authenticated;


-- ── pending_work_open (recreated to pick up the new column) ──────────────────

CREATE VIEW pending_work_open WITH (security_invoker = true) AS
SELECT pw.*, v.name AS vehicle_name, v.year, v.make, v.model, s.name AS assigned_shop_name
FROM pending_work pw
JOIN vehicles v   ON v.id = pw.vehicle_id
LEFT JOIN shops s ON s.id = pw.assigned_shop_id
WHERE pw.status NOT IN ('completed', 'cancelled');

GRANT SELECT ON pending_work_open TO authenticated;


-- ── 4. A passing re-test closes its "fix it" items ───────────────────────────

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
    SELECT pw.id
    FROM   pending_work pw
    JOIN   inspection_fulfillments f ON f.id = pw.source_inspection_fulfillment_id
    WHERE  f.inspection_id = NEW.inspection_id
      AND  f.id <> NEW.id
      AND  f.inspection_date <= NEW.inspection_date
      AND  pw.status NOT IN ('completed', 'cancelled')
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

DROP TRIGGER IF EXISTS trg_close_repairs_on_pass ON inspection_fulfillments;
CREATE TRIGGER trg_close_repairs_on_pass
  AFTER INSERT OR UPDATE OF result, service_record_id ON inspection_fulfillments
  FOR EACH ROW EXECUTE FUNCTION close_repairs_on_pass();


-- ── 5. Backfill: 04 Suburban 2026-09-19 failures ─────────────────────────────

INSERT INTO pending_work (
  vehicle_id, title, description, priority, status, identified_date, source,
  reported_by, source_inspection_fulfillment_id
)
SELECT
  i.vehicle_id,
  format('Repairs to pass %s inspection', i.inspection_type),
  NULLIF(btrim(f.notes), ''),
  'high',
  'pending',
  f.inspection_date,
  format('Failed %s inspection %s', i.inspection_type, to_char(f.inspection_date, 'MM/DD/YYYY')),
  (SELECT id FROM profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1),
  f.id
FROM inspection_fulfillments f
JOIN inspections i ON i.id = f.inspection_id
JOIN vehicles v    ON v.id = i.vehicle_id
WHERE f.result = 'fail'
  AND f.inspection_date = DATE '2026-09-19'
  AND v.name = '04 Suburban'
  AND NOT EXISTS (SELECT 1 FROM pending_work pw WHERE pw.source_inspection_fulfillment_id = f.id);


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
--   SELECT vehicle_name, inspection_type, inspection_date, result,
--          next_due_date, expiry_status, retest_overdue
--   FROM inspection_status ORDER BY vehicle_name, inspection_type;
--   SELECT title, description, source FROM pending_work
--   WHERE source_inspection_fulfillment_id IS NOT NULL;
-- ═════════════════════════════════════════════════════════════════════════════
