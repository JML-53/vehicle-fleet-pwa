-- ═════════════════════════════════════════════════════════════════════════════
-- Task 12: maintenance_fulfillments — replace scalar last_done_* columns with
-- a proper many-to-many join between maintenance_schedule and service_records.
--
-- What changes:
--   1. Create maintenance_fulfillments join table
--   2. Migrate existing data:
--        a. Match existing service_records to maintenance_schedule items by
--           vehicle + overlapping category + closest date
--        b. For items where last_done_service_record_id is already set, migrate
--           that link directly
--        c. For remaining items with last_done_date but no service record match,
--           copy last_done_date → baseline_date as the fallback
--   3. Recreate maintenance_due_soon view to derive last_done_* from the join
--   4. Drop the deprecated scalar columns from maintenance_schedule
-- ═════════════════════════════════════════════════════════════════════════════


-- ── 1. Create maintenance_fulfillments ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maintenance_fulfillments (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_schedule_id  uuid        NOT NULL
                             REFERENCES maintenance_schedule(id) ON DELETE CASCADE,
  service_record_id        uuid        NOT NULL
                             REFERENCES service_records(id)      ON DELETE CASCADE,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate links for the same pair
  UNIQUE (maintenance_schedule_id, service_record_id)
);

CREATE INDEX IF NOT EXISTS idx_mf_maintenance_schedule
  ON maintenance_fulfillments(maintenance_schedule_id);
CREATE INDEX IF NOT EXISTS idx_mf_service_record
  ON maintenance_fulfillments(service_record_id);


-- ── 2a. Migrate explicit last_done_service_record_id links ────────────────────
--
-- These are the cleanest: a direct FK already exists on maintenance_schedule.
-- Insert them into maintenance_fulfillments first, before we try fuzzy matching,
-- so the UNIQUE constraint prevents duplicates during the fuzzy pass.

INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes)
SELECT
  ms.id,
  ms.last_done_service_record_id,
  'Migrated from last_done_service_record_id'
FROM maintenance_schedule ms
WHERE ms.last_done_service_record_id IS NOT NULL
ON CONFLICT (maintenance_schedule_id, service_record_id) DO NOTHING;


-- ── 2b. Fuzzy-match remaining maintenance items to service_records ────────────
--
-- Strategy: for each maintenance_schedule item that doesn't yet have a
-- fulfillment, find the best-matching service_record for the same vehicle
-- where the category and service_item text overlap and the date is within
-- a reasonable window of last_done_date or baseline_date.
--
-- Matching rules (all must be true):
--   • Same vehicle_id
--   • Category overlap (maintenance category → service_record category)
--   • Date of service_record is within 60 days of last_done_date/baseline_date
--   • Only the closest match (by absolute date diff) is taken
--
-- Category mapping between maintenance_schedule categories and service_record
-- categories (both use the same enum values in our schema, so direct match).

INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes)
SELECT DISTINCT ON (ms.id)
  ms.id        AS maintenance_schedule_id,
  sr.id        AS service_record_id,
  'Auto-matched by category + date proximity (±60 days)'  AS notes
FROM maintenance_schedule ms
JOIN service_records sr
  ON  sr.vehicle_id = ms.vehicle_id
  -- Category must match
  AND sr.category   = ms.category
  -- service_record date must be within 60 days of our reference date
  AND ABS(
        EXTRACT(EPOCH FROM (
          sr.service_date::date
          - COALESCE(ms.last_done_date, ms.baseline_date)
        )) / 86400.0
      ) <= 60
-- Exclude items already covered by step 2a
WHERE NOT EXISTS (
  SELECT 1 FROM maintenance_fulfillments mf
  WHERE mf.maintenance_schedule_id = ms.id
)
-- Must have some reference date to match against
AND COALESCE(ms.last_done_date, ms.baseline_date) IS NOT NULL
-- Pick the closest match by date
ORDER BY ms.id,
         ABS(EXTRACT(EPOCH FROM (
           sr.service_date::date
           - COALESCE(ms.last_done_date, ms.baseline_date)
         )))
ON CONFLICT (maintenance_schedule_id, service_record_id) DO NOTHING;


-- ── 2c. Copy last_done_date → baseline_date for unmatched items ───────────────
--
-- For items that still have last_done_date but couldn't be matched to a
-- service_record, preserve the date as baseline_date so the view can still
-- compute a next_due_date. Only overwrite baseline_date if it is currently NULL.

UPDATE maintenance_schedule ms
SET    baseline_date    = ms.last_done_date,
       knowledge_status = CASE
                            WHEN ms.knowledge_status = 'confirmed' THEN 'estimated'
                            ELSE ms.knowledge_status
                          END
WHERE  ms.last_done_date IS NOT NULL
AND    ms.baseline_date  IS NULL
AND    NOT EXISTS (
         SELECT 1 FROM maintenance_fulfillments mf
         WHERE mf.maintenance_schedule_id = ms.id
       );


-- ── 3. Recreate maintenance_due_soon view ─────────────────────────────────────
--
-- last_done_date    → most recent service_record.service_date via fulfillments,
--                     fallback to baseline_date
-- last_done_mileage → most recent service_record.mileage_at_service via
--                     fulfillments (no fallback — mileage is only from records)
-- fulfillment_count → total number of linked service records (history depth)
-- last_done_record_id → id of the most recent fulfillment's service_record
--                       (for UI link-through)

DROP VIEW IF EXISTS maintenance_due_soon;

CREATE VIEW maintenance_due_soon AS
WITH latest_fulfillment AS (
  -- For each maintenance_schedule item, find the most recent linked service_record
  SELECT DISTINCT ON (mf.maintenance_schedule_id)
    mf.maintenance_schedule_id,
    sr.id              AS service_record_id,
    sr.service_date    AS last_done_date,
    sr.mileage_at_service AS last_done_mileage,
    COUNT(*) OVER (PARTITION BY mf.maintenance_schedule_id) AS fulfillment_count
  FROM maintenance_fulfillments mf
  JOIN service_records sr ON sr.id = mf.service_record_id
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
  ms.created_at,
  ms.updated_at,

  -- Last done sourced from most recent fulfillment, or baseline_date fallback
  COALESCE(lf.last_done_date,    ms.baseline_date)  AS last_done_date,
  lf.last_done_mileage                               AS last_done_mileage,
  lf.service_record_id                               AS last_done_service_record_id,
  COALESCE(lf.fulfillment_count, 0)                  AS fulfillment_count,

  -- Vehicle info
  v.name     AS vehicle_name,
  v.year,
  v.make,
  v.model,

  -- Current mileage for due-mileage calculation
  vcm.current_mileage,

  -- Next due date: prefer last_done_date (from fulfillment), then baseline_date
  CASE
    WHEN lf.last_done_date IS NOT NULL AND ms.interval_months IS NOT NULL
      THEN lf.last_done_date + (ms.interval_months || ' months')::interval
    WHEN ms.baseline_date  IS NOT NULL AND ms.interval_months IS NOT NULL
      THEN ms.baseline_date  + (ms.interval_months || ' months')::interval
    ELSE NULL
  END AS next_due_date,

  -- Confidence alias kept for backwards compatibility
  ms.knowledge_status AS confidence

FROM maintenance_schedule ms
JOIN vehicles v            ON v.id          = ms.vehicle_id
LEFT JOIN vehicle_current_mileage vcm
                           ON vcm.vehicle_id = ms.vehicle_id
LEFT JOIN latest_fulfillment lf
                           ON lf.maintenance_schedule_id = ms.id;


-- ── 4. Drop deprecated columns from maintenance_schedule ──────────────────────
--
-- These are now derived from maintenance_fulfillments via the view.
-- Run these after confirming the view and UI are working correctly.
-- IMPORTANT: Review the migration output above first to ensure data was
-- migrated correctly before running this section.
--
-- Uncomment and run separately once you've verified the view data looks right:
--
-- ALTER TABLE maintenance_schedule DROP COLUMN IF EXISTS last_done_date;
-- ALTER TABLE maintenance_schedule DROP COLUMN IF EXISTS last_done_mileage;
-- ALTER TABLE maintenance_schedule DROP COLUMN IF EXISTS last_done_service_record_id;
-- ALTER TABLE maintenance_schedule DROP COLUMN IF EXISTS last_done_mileage_id;
--
-- Note: baseline_date and knowledge_status are KEPT — they serve as fallback
-- for items with estimated/assumed knowledge and no linked service record.
