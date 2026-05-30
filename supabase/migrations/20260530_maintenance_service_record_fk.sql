-- ─────────────────────────────────────────────────────────────────────────────
-- Add last_done_service_record_id FK to maintenance_schedule
-- This links a maintenance schedule item to the service_record that confirmed
-- the maintenance was performed, enabling:
--   • A click-through link from the maintenance table to the service record
--   • Future auto-fulfillment when saving a service record (Enhancement 15)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE maintenance_schedule
  ADD COLUMN IF NOT EXISTS last_done_service_record_id uuid
    REFERENCES service_records(id) ON DELETE SET NULL;

-- DROP + CREATE required because CREATE OR REPLACE cannot reorder/rename existing columns
-- (PostgreSQL raises 42P16 if the column list changes). Safe to drop — views store no data.
DROP VIEW IF EXISTS maintenance_due_soon;

CREATE VIEW maintenance_due_soon AS
SELECT
  ms.*,
  v.name          AS vehicle_name,
  v.year,
  v.make,
  v.model,
  vcm.current_mileage,
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
