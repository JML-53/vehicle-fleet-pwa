-- ═════════════════════════════════════════════════════════════════════════════
-- Task 12: maintenance_fulfillments
--
-- Replaces scalar last_done_* columns on maintenance_schedule with a proper
-- many-to-many join to service_records.
--
-- Schema discoveries (from 260530 Schema.sql):
--   • maintenance_schedule has NO category column → add it here
--   • service_records has NO mileage_at_service → mileage lives in mileage_log
--     linked via mileage_log.service_visit_id = service_records.visit_id
--
-- Run this file in full first (all sections except the DROP block at the end).
-- Verify data with the queries in the comment at the bottom, then run the
-- DROP block separately.
-- ═════════════════════════════════════════════════════════════════════════════


-- ── 1. Add category column to maintenance_schedule ────────────────────────────
-- Needed for the AddMaintenanceItem form and for future fuzzy-matching.
-- Using the same service_category enum already on service_records.

ALTER TABLE maintenance_schedule
  ADD COLUMN IF NOT EXISTS category service_category;


-- ── 2. Create maintenance_fulfillments ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maintenance_fulfillments (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_schedule_id  uuid        NOT NULL
                             REFERENCES maintenance_schedule(id) ON DELETE CASCADE,
  service_record_id        uuid        NOT NULL
                             REFERENCES service_records(id)      ON DELETE CASCADE,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (maintenance_schedule_id, service_record_id)
);

CREATE INDEX IF NOT EXISTS idx_mf_maintenance_schedule
  ON maintenance_fulfillments(maintenance_schedule_id);
CREATE INDEX IF NOT EXISTS idx_mf_service_record
  ON maintenance_fulfillments(service_record_id);


-- ── 3. Migrate explicit last_done_service_record_id links ─────────────────────
-- These are the safest links — already confirmed by hand.

INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes)
SELECT
  ms.id,
  ms.last_done_service_record_id,
  'Migrated from last_done_service_record_id'
FROM maintenance_schedule ms
WHERE ms.last_done_service_record_id IS NOT NULL
ON CONFLICT (maintenance_schedule_id, service_record_id) DO NOTHING;


-- ── 4. Copy last_done_date → baseline_date for unmatched items ────────────────
-- For items that have a last_done_date but no fulfillment link, preserve the
-- date as baseline_date so next_due_date can still be computed.
-- Only fills baseline_date when it is currently NULL.
-- Downgrades confidence from 'confirmed' → 'estimated' since it's now just a
-- date with no backing service record.

UPDATE maintenance_schedule ms
SET
  baseline_date    = ms.last_done_date,
  knowledge_status = CASE
                       WHEN ms.knowledge_status = 'confirmed' THEN 'estimated'
                       ELSE ms.knowledge_status
                     END
WHERE ms.last_done_date IS NOT NULL
  AND ms.baseline_date  IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM maintenance_fulfillments mf
    WHERE mf.maintenance_schedule_id = ms.id
  );


-- ── 5. Recreate maintenance_due_soon view ─────────────────────────────────────
--
-- last_done_date    → most recent service_record.service_date via fulfillments,
--                     falls back to baseline_date if no fulfillment
-- last_done_mileage → most recent mileage_log entry for the service_visit
--                     that the service_record belongs to
--                     (service_records.visit_id → mileage_log.service_visit_id)
-- fulfillment_count → total fulfillments (history depth indicator)
-- last_done_service_record_id → id of most recent fulfillment's service_record

DROP VIEW IF EXISTS maintenance_due_soon;

CREATE VIEW maintenance_due_soon AS
WITH latest_fulfillment AS (
  SELECT DISTINCT ON (mf.maintenance_schedule_id)
    mf.maintenance_schedule_id,
    sr.id              AS service_record_id,
    sr.service_date    AS last_done_date,
    ml.mileage         AS last_done_mileage,
    COUNT(*) OVER (PARTITION BY mf.maintenance_schedule_id) AS fulfillment_count
  FROM maintenance_fulfillments mf
  JOIN service_records sr
    ON sr.id = mf.service_record_id
  LEFT JOIN mileage_log ml
    ON ml.service_visit_id = sr.visit_id
  ORDER BY mf.maintenance_schedule_id, sr.service_date DESC NULLS LAST
)
SELECT
  ms.id,
  ms.vehicle_id,
  ms.service_item,
  ms.category,
  ms.interval_months,
  ms.interval_miles,
  ms.priority,
  ms.notes,
  ms.knowledge_status,
  ms.baseline_date,
  ms.baseline_basis,
  ms.created_at,
  ms.updated_at,

  -- Last done: fulfillment-derived or baseline fallback
  COALESCE(lf.last_done_date,    ms.baseline_date) AS last_done_date,
  lf.last_done_mileage                              AS last_done_mileage,
  lf.service_record_id                              AS last_done_service_record_id,
  COALESCE(lf.fulfillment_count, 0)                 AS fulfillment_count,

  -- Vehicle info
  v.name     AS vehicle_name,
  v.year,
  v.make,
  v.model,

  -- Current mileage (for due-mileage calculation)
  vcm.current_mileage,

  -- Next due date
  CASE
    WHEN lf.last_done_date IS NOT NULL AND ms.interval_months IS NOT NULL
      THEN lf.last_done_date + (ms.interval_months || ' months')::interval
    WHEN ms.baseline_date  IS NOT NULL AND ms.interval_months IS NOT NULL
      THEN ms.baseline_date  + (ms.interval_months || ' months')::interval
    ELSE NULL
  END AS next_due_date,

  -- Confidence alias for backwards compatibility
  ms.knowledge_status AS confidence

FROM maintenance_schedule ms
JOIN  vehicles v                 ON v.id           = ms.vehicle_id
LEFT JOIN vehicle_current_mileage vcm
                                 ON vcm.vehicle_id  = ms.vehicle_id
LEFT JOIN latest_fulfillment lf  ON lf.maintenance_schedule_id = ms.id;


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES — run these after the above to check results
-- ═════════════════════════════════════════════════════════════════════════════
--
-- 1. See which maintenance items got fulfillment links:
--
-- SELECT ms.service_item, v.name AS vehicle,
--        mf.id IS NOT NULL AS has_fulfillment,
--        sr.service_date, sr.title, mf.notes AS match_method
-- FROM maintenance_schedule ms
-- JOIN vehicles v ON v.id = ms.vehicle_id
-- LEFT JOIN maintenance_fulfillments mf ON mf.maintenance_schedule_id = ms.id
-- LEFT JOIN service_records sr ON sr.id = mf.service_record_id
-- ORDER BY v.name, ms.service_item;
--
-- 2. Check the view computes correctly:
--
-- SELECT vehicle_name, service_item, last_done_date, last_done_mileage,
--        next_due_date, fulfillment_count, confidence
-- FROM maintenance_due_soon
-- ORDER BY vehicle_name, service_item;
--
-- ═════════════════════════════════════════════════════════════════════════════
-- DROP BLOCK — run SEPARATELY after verifying data looks correct
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ALTER TABLE maintenance_schedule DROP COLUMN IF EXISTS last_done_date;
-- ALTER TABLE maintenance_schedule DROP COLUMN IF EXISTS last_done_mileage;
-- ALTER TABLE maintenance_schedule DROP COLUMN IF EXISTS last_done_service_record_id;
-- ALTER TABLE maintenance_schedule DROP COLUMN IF EXISTS last_done_mileage_id;
