-- ═════════════════════════════════════════════════════════════════════════════
-- One-time backfill: link historical service_records to the maintenance
-- schedule items they fulfilled (roadmap item 12.2).
--
-- NOT a migration — a reviewed data fix. Generated 2026-10-04 by running
-- src/lib/maintenanceMatch.js (same scorer the forms use) against live data:
--   71 service records · 90 schedule items · 5 records already linked
--   → 4 strong matches, 36 weak; every weak match was reviewed by hand.
--
-- SECTIONS
--   A  Strong matches (score ≥ 2, what the forms would auto-tick) .... ACTIVE
--   B  Weak score, reviewed and clearly right ........................ ACTIVE
--   C  Plausible, your call — uncomment the INSERT line to include ... OFF
--   Rejected weak matches are omitted (e.g. brake pads → Brake Fluid Flush,
--   tire purchase → Front Control Arms, fuel tank → Fuel Filter).
--
-- HOW TO RUN: Supabase → SQL Editor → paste this whole file → Run.
-- SAFE TO RE-RUN: explicit id pairs + ON CONFLICT DO NOTHING.
-- Every inserted row is tagged notes = 'Backfill 2026-10-04' (see ROLLBACK).
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── A. Strong matches ────────────────────────────────────────────────────────

-- 04 Suburban · 2026-05-19 · "Rear Brake Pads, Rotors, Caliper & Bleeder Screw Replacement with Brake System Flush" → Brake Fluid Flush   (score 2, item was unknown)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('c2139e63-840e-4679-80c8-7eadbd324967', '12b9b98b-ee50-4f2b-88d9-11074f842956', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- The Rover · 2022-02-18 · "Oil Service" → Engine Oil & Filter   (score 2, item was confirmed)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('d81c2204-29a7-4c37-9f42-d6a768f0df4c', '4dee1d20-3491-4864-88d4-09953fc86b07', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- The Rover · 2023-04-25 · "Oil Service" → Engine Oil & Filter   (score 2, item was confirmed)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('d81c2204-29a7-4c37-9f42-d6a768f0df4c', '73215fc1-f20f-4816-9e4e-624b6d827b40', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- The Rover · 2024-04-26 · "Oil Service" → Engine Oil & Filter   (score 2, item was confirmed)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('d81c2204-29a7-4c37-9f42-d6a768f0df4c', 'e2c4aefa-c58e-417d-aa62-28683cbedbd8', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;


-- ── B. Reviewed weak matches ─────────────────────────────────────────────────
-- Single-word schedule items ("Battery") can never score above 1.5, so these
-- fall below the auto threshold despite being exact.

-- Betsy · 2026-08-29 · "Car Battery Purchase" → Battery   (score 1.5, item was unknown)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('7ac35b31-94f9-4b39-baaa-23640afc1682', 'ffed088d-db55-4fdb-9ca7-4c57674cf3f3', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- Gandalf · 2026-08-12 · "Inspection - Brakes, Shocks, Battery & TPMS" → Brake Inspection   (score 1.5, item was unknown)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('78125949-87fb-4a3e-8571-1da9446d8fe2', '4aa34185-ef9e-4e6d-b8ab-c59f39372c97', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- The Rover · 2015-05-02 · "Battery" → Battery   (score 1.5, item was confirmed)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('20c09c48-044f-4452-91f8-0804a187dd9b', '10bda105-c789-4735-af81-b74b1adb58f7', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- The Rover · 2018-10-12 · "Battery" → Battery   (score 1.5, item was confirmed)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('20c09c48-044f-4452-91f8-0804a187dd9b', 'eb78d17c-be1c-42bf-9aad-546e939678f5', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;


-- ── C. Your call (commented out — remove the leading "-- " on INSERT lines) ──

-- 04 Suburban · 2024-05-31 · "VA Safety Inspection" → Exhaust System Inspection   (score 1, item was unknown; VA safety inspection checks the exhaust)
-- INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('ef7fecfd-87e3-4813-8d28-18dcbb942d55', '99d20fc5-035f-43f6-a5d8-13383cd426a3', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- 04 Suburban · 2026-09-19 · "Safety Inspection" → Exhaust System Inspection   (score 1, item was unknown; VA safety inspection checks the exhaust)
-- INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('ef7fecfd-87e3-4813-8d28-18dcbb942d55', 'e42b3c1b-da1e-4d25-90d2-6ca1d84907f5', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- Betsy · 2026-06-06 · "Changed front brake pads and rotors." → Brake System Inspection   (score 1.5, item was confirmed; pad job — brakes were inspected as part of it)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('89429751-c2af-459b-b541-b63e707f13f7', '16a5e6b5-40d7-46da-92a4-4e2a48f5cd3c', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- Gandalf · 2023-03-08 · "Front Brake Pads & Rotors" → Brake Inspection   (score 1.5, item was unknown; pad job — brakes were inspected as part of it)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('78125949-87fb-4a3e-8571-1da9446d8fe2', '04dcecaa-9c14-464d-a9c6-f335ea69ff0b', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- Gandalf · 2023-03-08 · "Tires — All 4 (Eagle Sport All-Season)" → Tire Rotation   (score 1.5, item was estimated; new set of 4 restarts the rotation clock)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('b1463fba-dc04-4f62-930a-256caffd219b', '834b1f8d-907c-4b39-bd29-dda2246718c1', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- Gandalf · 2025-11-30 · "Rear Brake Pads" → Brake Inspection   (score 1.5, item was unknown; pad job — brakes were inspected as part of it)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('78125949-87fb-4a3e-8571-1da9446d8fe2', '3bc11220-2d8e-4e13-8702-12c92f42a64f', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- Gandalf · 2025-11-30 · "Tires — All 4 (Colorado trip damage)" → Tire Rotation   (score 1.5, item was estimated; new set of 4 restarts the rotation clock)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('b1463fba-dc04-4f62-930a-256caffd219b', '2011a23c-efac-4d64-8cb6-9b2a496616c1', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- The Rover · 2013-10-29 · "Tires" → Tire Rotation   (score 1.5, item was estimated; vague title — only if this was a full set or included rotation)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('139f4066-ed8b-4fb3-8b97-9bb125446bfa', 'a6137dc2-6109-45eb-ab4c-9770b4fc753e', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- The Rover · 2015-03-05 · "36k Service / Brakes" → Brake Fluid Flush   (score 1.5, item was estimated; only if the 36k service included a fluid flush)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('d397c28d-0256-4a8d-80b0-abbbf427d99c', 'ce2001fd-fcd9-4ead-be5a-6ac0492d7588', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;

-- The Rover · 2020-01-23 · "Service / Inspection" → Routine Inspection (15k Service)   (score 1, item was unknown; only if this visit was the JLR routine service)
INSERT INTO maintenance_fulfillments (maintenance_schedule_id, service_record_id, notes) VALUES ('2c48d872-c2c2-40cb-80bc-4d5f360f80b8', '189ae892-1406-404f-b8c8-2fda6fcca869', 'Backfill 2026-10-04') ON CONFLICT DO NOTHING;


-- ── Mark linked items confirmed (same rule the app applies) ──────────────────
-- Prior values are noted on each line above ("item was …").

UPDATE maintenance_schedule
SET    knowledge_status = 'confirmed'
WHERE  id IN (
  SELECT maintenance_schedule_id FROM maintenance_fulfillments
  WHERE  notes = 'Backfill 2026-10-04'
)
AND    knowledge_status IS DISTINCT FROM 'confirmed';

COMMIT;


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY — run after; shows each backfilled item's new last-done / next-due
-- ═════════════════════════════════════════════════════════════════════════════
--
-- SELECT vehicle_name, service_item, last_done_date, last_done_mileage,
--        next_due_date, fulfillment_count, confidence
-- FROM   maintenance_due_soon
-- WHERE  id IN (SELECT maintenance_schedule_id FROM maintenance_fulfillments
--               WHERE notes = 'Backfill 2026-10-04')
-- ORDER  BY vehicle_name, service_item;
--
-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — removes every link this script created (knowledge_status is not
-- reverted; restore by hand from the "item was …" notes if needed)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- DELETE FROM maintenance_fulfillments WHERE notes = 'Backfill 2026-10-04';
