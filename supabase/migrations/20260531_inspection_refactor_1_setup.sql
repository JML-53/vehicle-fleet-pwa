-- ════════════════════════════════════════════════════════════════════════════
-- Item 22 — Stage 1: Create inspection_fulfillments, populate from existing data
-- Run this, verify with the queries at the bottom, then run Stage 2.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Create inspection_fulfillments ──────────────────────────────────────
CREATE TABLE inspection_fulfillments (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id         uuid        NOT NULL REFERENCES inspections(id),
  service_record_id     uuid        REFERENCES service_records(id) ON DELETE SET NULL,
  inspection_date       date        NOT NULL,
  expiry_date           date,
  result                inspection_result,
  report_number         text,
  shop_id               uuid        REFERENCES shops(id) ON DELETE SET NULL,
  document_id           uuid,
  mileage_at_inspection int4,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inf_inspection_id     ON inspection_fulfillments(inspection_id);
CREATE INDEX idx_inf_service_record_id ON inspection_fulfillments(service_record_id);
CREATE INDEX idx_inf_inspection_date   ON inspection_fulfillments(inspection_date);

ALTER TABLE inspection_fulfillments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read inf"   ON inspection_fulfillments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert inf" ON inspection_fulfillments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update inf" ON inspection_fulfillments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete inf" ON inspection_fulfillments FOR DELETE TO authenticated USING (true);

-- ─── 2. Add interval_months to inspections ──────────────────────────────────
-- (event-level columns will be dropped in Stage 2 after verification)
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS interval_months int4;

-- ─── 3a. Canonical row per vehicle/type ─────────────────────────────────────
-- All fulfillments will reference this id for a given (vehicle_id, inspection_type).
-- Canonical = row with the latest inspection_date (matches the existing view logic).
CREATE TEMP TABLE canonical_inspections AS
SELECT DISTINCT ON (vehicle_id, inspection_type)
  id, vehicle_id, inspection_type
FROM inspections
ORDER BY vehicle_id, inspection_type, inspection_date DESC;

-- ─── 3b. Populate from maintenance_fulfillments ─────────────────────────────
-- Finds inspection service_records linked via maintenance_fulfillments,
-- cross-references inspections table for expiry_date / result / report_number.
INSERT INTO inspection_fulfillments (
  inspection_id, service_record_id, inspection_date, expiry_date,
  result, report_number, shop_id, document_id, mileage_at_inspection, notes
)
SELECT DISTINCT ON (c.id, sr.service_date)
  c.id                   AS inspection_id,
  mf.service_record_id,
  sr.service_date        AS inspection_date,
  i_match.expiry_date,
  i_match.result,
  i_match.report_number,
  COALESCE(sv.shop_id, i_match.shop_id) AS shop_id,
  i_match.document_id,
  ml.mileage             AS mileage_at_inspection,
  sr.notes
FROM maintenance_fulfillments mf
JOIN service_records       sr      ON sr.id      = mf.service_record_id
JOIN maintenance_schedule  ms      ON ms.id      = mf.maintenance_schedule_id
JOIN canonical_inspections c       ON c.vehicle_id = ms.vehicle_id
  AND (
    (ms.service_item ILIKE '%safety%'    AND c.inspection_type = 'safety')
    OR (ms.service_item ILIKE '%emission%' AND c.inspection_type = 'emissions')
  )
LEFT JOIN service_visits sv        ON sv.id       = sr.visit_id
LEFT JOIN mileage_log    ml        ON ml.service_visit_id = sr.visit_id
-- Try to match an inspections row for the same vehicle/type/date to grab result, expiry, report
LEFT JOIN inspections    i_match   ON i_match.vehicle_id     = c.vehicle_id
                                   AND i_match.inspection_type = c.inspection_type
                                   AND i_match.inspection_date = sr.service_date
ORDER BY c.id, sr.service_date;

-- ─── 3c. Populate from inspections table (events not captured above) ─────────
-- Picks up any inspection event rows not already linked via maintenance_fulfillments.
INSERT INTO inspection_fulfillments (
  inspection_id, service_record_id, inspection_date, expiry_date,
  result, report_number, shop_id, document_id, mileage_at_inspection, notes
)
SELECT
  c.id   AS inspection_id,
  NULL   AS service_record_id,
  i.inspection_date,
  i.expiry_date,
  i.result,
  i.report_number,
  i.shop_id,
  i.document_id,
  ml.mileage AS mileage_at_inspection,
  i.notes
FROM inspections i
JOIN canonical_inspections c ON c.vehicle_id = i.vehicle_id
                             AND c.inspection_type = i.inspection_type
LEFT JOIN mileage_log ml ON ml.inspection_id = i.id
WHERE NOT EXISTS (
  SELECT 1 FROM inspection_fulfillments inf
  WHERE inf.inspection_id    = c.id
    AND inf.inspection_date  = i.inspection_date
);

DROP TABLE canonical_inspections;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES — run these before proceeding to Stage 2
-- ════════════════════════════════════════════════════════════════════════════

-- 1. One fulfillment row per vehicle/type/date?  (should be no duplicates)
-- SELECT inspection_id, inspection_date, COUNT(*)
-- FROM inspection_fulfillments
-- GROUP BY inspection_id, inspection_date
-- HAVING COUNT(*) > 1;

-- 2. Coverage vs original inspections table
-- SELECT v.name, i.inspection_type, COUNT(insp.inspection_date) AS original_events,
--        COUNT(inf.id) AS fulfillment_rows
-- FROM inspections i
-- JOIN vehicles v ON v.id = i.vehicle_id
-- LEFT JOIN inspections insp ON insp.vehicle_id = i.vehicle_id
--                           AND insp.inspection_type = i.inspection_type
-- LEFT JOIN inspection_fulfillments inf ON inf.inspection_id IN (
--   SELECT DISTINCT ON (vehicle_id, inspection_type) id FROM inspections
--   ORDER BY vehicle_id, inspection_type, inspection_date DESC
-- ) AND inf.inspection_date = insp.inspection_date
-- GROUP BY v.name, i.inspection_type, i.vehicle_id
-- ORDER BY v.name, i.inspection_type;

-- 3. Full data review
-- SELECT v.name, inf.inspection_type AS type, inf.inspection_date, inf.expiry_date,
--        inf.result, inf.report_number, inf.mileage_at_inspection,
--        CASE WHEN inf.service_record_id IS NOT NULL THEN 'linked' ELSE 'no SR' END AS sr_status
-- FROM inspection_fulfillments inf
-- JOIN inspections i ON i.id = inf.inspection_id
-- JOIN vehicles v ON v.id = i.vehicle_id
-- ORDER BY v.name, i.inspection_type, inf.inspection_date DESC;
