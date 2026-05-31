-- ════════════════════════════════════════════════════════════════════════════
-- Item 22 — Stage 2: Cleanup
-- Only run after verifying Stage 1 data with the queries in that file.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Remap mileage_log.inspection_id to canonical rows, then null it ─────
-- Any mileage_log row pointing to a non-canonical inspections row gets its
-- FK nulled out (the mileage data is already captured in inspection_fulfillments).
UPDATE mileage_log SET inspection_id = NULL
WHERE inspection_id IS NOT NULL;
-- Note: leave the column in place for now — dropping it is a separate decision.

-- ─── 2. Set interval_months on the canonical inspection rows ─────────────────
-- Virginia: safety = 12 months, emissions = 24 months
UPDATE inspections SET interval_months = 12 WHERE inspection_type = 'safety';
UPDATE inspections SET interval_months = 24 WHERE inspection_type = 'emissions';

-- ─── 3. Delete non-canonical inspections rows ────────────────────────────────
-- Keeps exactly one row per vehicle/type (the one all fulfillments point to).
DELETE FROM inspections
WHERE id NOT IN (
  SELECT DISTINCT ON (vehicle_id, inspection_type) id
  FROM inspections
  ORDER BY vehicle_id, inspection_type, inspection_date DESC
);

-- ─── 4. Drop view BEFORE dropping columns it depends on ─────────────────────
DROP VIEW IF EXISTS inspection_status;

-- ─── 5. Drop event-level columns from inspections ────────────────────────────
-- These now live in inspection_fulfillments.
ALTER TABLE inspections
  DROP COLUMN IF EXISTS inspection_date,
  DROP COLUMN IF EXISTS expiry_date,
  DROP COLUMN IF EXISTS result,
  DROP COLUMN IF EXISTS report_number,
  DROP COLUMN IF EXISTS shop_id,
  DROP COLUMN IF EXISTS document_id,
  DROP COLUMN IF EXISTS notes;

-- ─── 6. Remove inspection items from maintenance_fulfillments ─────────────────
DELETE FROM maintenance_fulfillments
WHERE maintenance_schedule_id IN (
  SELECT id FROM maintenance_schedule
  WHERE service_item ILIKE '%safety%'
     OR service_item ILIKE '%emission%'
     OR service_item ILIKE '%inspect%'
);

-- ─── 6. Remove inspection items from maintenance_schedule ─────────────────────
DELETE FROM maintenance_schedule
WHERE service_item ILIKE '%safety%'
   OR service_item ILIKE '%emission%'
   OR service_item ILIKE '%inspect%';

-- ─── 7. Recreate inspection_status view ──────────────────────────────────────
DROP VIEW IF EXISTS inspection_status;

CREATE VIEW inspection_status AS
SELECT
  i.id,
  i.vehicle_id,
  i.inspection_type,
  i.interval_months,
  v.name         AS vehicle_name,
  v.year,
  v.make,
  v.model,
  v.current_plate,
  -- Latest event from inspection_fulfillments
  inf.id                   AS fulfillment_id,
  inf.inspection_date,
  inf.expiry_date,
  inf.result,
  inf.report_number,
  inf.shop_id,
  inf.document_id,
  inf.mileage_at_inspection,
  inf.service_record_id,
  -- Next due date: use expiry_date if set; otherwise compute from interval
  -- VA rule: expires end of month, interval_months from inspection month
  COALESCE(
    inf.expiry_date,
    CASE WHEN inf.inspection_date IS NOT NULL
      THEN (date_trunc('month', inf.inspection_date + (i.interval_months || ' months')::interval)
            + interval '1 month - 1 day')::date
    END
  ) AS next_due_date,
  -- Status
  CASE
    WHEN inf.inspection_date IS NULL  THEN 'unknown'
    WHEN COALESCE(inf.expiry_date,
           (date_trunc('month', inf.inspection_date + (i.interval_months || ' months')::interval)
            + interval '1 month - 1 day')::date
         ) < CURRENT_DATE                               THEN 'expired'
    WHEN COALESCE(inf.expiry_date,
           (date_trunc('month', inf.inspection_date + (i.interval_months || ' months')::interval)
            + interval '1 month - 1 day')::date
         ) < CURRENT_DATE + interval '60 days'          THEN 'due_soon'
    ELSE 'current'
  END AS expiry_status,
  COALESCE(inf.expiry_date,
    (date_trunc('month', inf.inspection_date + (i.interval_months || ' months')::interval)
     + interval '1 month - 1 day')::date
  ) - CURRENT_DATE AS days_until_expiry
FROM inspections i
JOIN vehicles v ON v.id = i.vehicle_id
LEFT JOIN LATERAL (
  SELECT *
  FROM inspection_fulfillments
  WHERE inspection_id = i.id
  ORDER BY inspection_date DESC
  LIMIT 1
) inf ON true;
