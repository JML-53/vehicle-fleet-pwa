-- ─────────────────────────────────────────────────────────────────────────────
-- Recreate maintenance_due_soon view to pick up last_done_mileage column.
-- PostgreSQL freezes the column list for `ms.*` at view-creation time, so
-- the column added via ALTER TABLE was invisible until the view is recreated.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW maintenance_due_soon AS
SELECT
  ms.*,
  v.name          AS vehicle_name,
  v.year,
  v.make,
  v.model,
  vcm.current_mileage,
  -- Compute next due date from confirmed date or baseline date
  CASE
    WHEN ms.last_done_date  IS NOT NULL AND ms.interval_months IS NOT NULL
      THEN ms.last_done_date + (ms.interval_months || ' months')::interval
    WHEN ms.baseline_date   IS NOT NULL AND ms.interval_months IS NOT NULL
      THEN ms.baseline_date  + (ms.interval_months || ' months')::interval
    ELSE NULL
  END                                    AS next_due_date,
  ms.knowledge_status                    AS confidence
FROM maintenance_schedule ms
JOIN vehicles v ON v.id = ms.vehicle_id
LEFT JOIN vehicle_current_mileage vcm ON vcm.vehicle_id = ms.vehicle_id;
