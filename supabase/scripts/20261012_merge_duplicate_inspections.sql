-- ═════════════════════════════════════════════════════════════════════════════
-- One-time merge: one inspection event = one service record (item 9.3)
--
-- Uploading a receipt created a visit + "…Inspection…" line item; logging the
-- same inspection on the Inspections tab created a SECOND visit + record. This
-- points each inspection at the receipt's record (and its document) and removes
-- the duplicate visit/record/mileage the inspection form created.
-- Going forward, the form attaches to the existing record instead (AddInspection
-- "one event, one record"), and uploaded reports do it automatically.
--
-- Reviewed data fix, not a migration. Generated 2026-10-12.
-- HOW TO RUN: Supabase → SQL Editor → paste → Run. All-or-nothing (BEGIN/COMMIT).
-- Section C is commented out — your call.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── A. 04 Suburban — 2026-09-19 (both failed; repair items keep working) ─────

-- Safety: inspection → receipt record "Virginia State Safety Inspection - Rejected"
UPDATE inspection_fulfillments
SET    service_record_id = '399c4913-9f3c-444f-8e11-2c8f8cd369c3',
       document_id       = '31635518-c38a-4cb7-8c73-ae6b1b93f608'
WHERE  id = 'e94a3bcc-0cab-4ac0-9f7e-851a594efa51';
-- …remove the duplicate "Safety Inspection" visit the form created (its only record + duplicate 232,213 mi reading)
DELETE FROM mileage_log     WHERE id = '3f2f130e-38aa-41d4-b120-98364e8f5842';
DELETE FROM service_records WHERE id = 'e42b3c1b-da1e-4d25-90d2-6ca1d84907f5';
DELETE FROM service_visits  WHERE id = 'fb527937-d3ee-42e8-acaf-9920dfce90dc';

-- Emissions: inspection → receipt record "Virginia Vehicle Emissions Inspection - FAIL"
UPDATE inspection_fulfillments
SET    service_record_id = 'd16e049f-54b3-4b59-808f-600ae24e250b',
       document_id       = 'bdbcd417-c999-4c75-9be1-0d8c57a67077'
WHERE  id = 'c0536a3f-1e85-476f-b8f0-54f130088218';
-- …remove the duplicate "Emissions Inspection" visit (its only record + duplicate mileage reading)
DELETE FROM mileage_log     WHERE id = '1ef42a54-dee3-4e16-9aad-fafec1cb6dee';
DELETE FROM service_records WHERE id = 'fa8391db-b2dd-4cff-8041-343efb51ff85';
DELETE FROM service_visits  WHERE id = 'b9d3a0ba-a28b-4712-ae7f-d990d11b85ad';


-- ── B. Betsy — link the inspections to their receipts (no duplicates to remove) ─

-- Safety (logged 9/17) → receipt record "Virginia State Vehicle Inspection" dated 9/15
UPDATE inspection_fulfillments
SET    service_record_id = '0ae59cd6-7a80-4500-b26e-83853dcbaec5',
       document_id       = '0b4583d6-852b-4eaa-8da4-b5ac95a5c5c8'
WHERE  id = '9fcf66b6-2d45-44fa-8591-e01be94926cf';
-- DATE CHECK: the receipt says 9/15 but the inspection log says 9/17. The expiry
-- (9/30/2027) is the same either way. If 9/15 is the real date, uncomment:
-- UPDATE inspection_fulfillments SET inspection_date = DATE '2026-09-15'
-- WHERE id = '9fcf66b6-2d45-44fa-8591-e01be94926cf';

-- Emissions 9/17 → receipt record "Virginia Vehicle Emissions Inspection"
UPDATE inspection_fulfillments
SET    service_record_id = '76f81b90-dccf-447e-aca1-db0c0605b906',
       document_id       = 'fa90cb9d-ea7c-4771-856d-7c432faf6956'
WHERE  id = 'ba0133d5-11d8-49d1-94a3-c022e35b1ea5';


-- ── C. The Rover — 2026-09-24 emissions receipt is NOT in the inspection log ──
-- The Inspections tab still shows the 4/30/2026 emissions test (due 4/30/2027).
-- If the 9/24 test PASSED, uncomment to log it against the receipt's record
-- (Virginia emissions: expires end of month, 24 months later → 9/30/2028):
--
-- INSERT INTO inspection_fulfillments
--   (inspection_id, service_record_id, document_id, inspection_date, expiry_date, result, mileage_at_inspection)
-- SELECT i.id, '74807468-7189-4425-ac5e-f4e477083cd6', 'dea6f93d-427b-463f-bbf4-04dc960b657f',
--        DATE '2026-09-24', DATE '2028-09-30', 'pass', 95208
-- FROM inspections i
-- WHERE i.vehicle_id = 'b6aa353e-8b00-44a8-89d5-0cfa9d07c004' AND i.inspection_type = 'emissions';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY — each September inspection should show exactly one record + its document
--   SELECT v.name, i.inspection_type, f.inspection_date, f.result,
--          sr.title AS record, f.document_id IS NOT NULL AS has_document
--   FROM inspection_fulfillments f
--   JOIN inspections i ON i.id = f.inspection_id
--   JOIN vehicles v    ON v.id = i.vehicle_id
--   LEFT JOIN service_records sr ON sr.id = f.service_record_id
--   WHERE f.inspection_date >= DATE '2026-09-01'
--   ORDER BY v.name, i.inspection_type;
-- ═════════════════════════════════════════════════════════════════════════════
