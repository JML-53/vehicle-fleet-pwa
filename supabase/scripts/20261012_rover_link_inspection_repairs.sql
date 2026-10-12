-- One-time data fix — The Rover: link split repair items to the failed safety inspection
-- Reviewed by Joe before running. Run with:
--   npx supabase db query --linked -f supabase/scripts/20261012_rover_link_inspection_repairs.sql
--
-- WHY
--   The failed safety inspection on 2026-09-24 (fulfillment 1931e91f…) created the umbrella
--   "Repairs to pass safety inspection". The document review (9.4 "Also found") also created
--   "Replace both front tires" and "Repair parking brake", but linked them only to the
--   document. close_repairs_on_pass (item 28) closes only items whose
--   source_inspection_fulfillment_id points at the failed inspection, so a passing re-test
--   would close the umbrella and leave these two open.
--
-- WHAT
--   Lines 1–2 (active): set source_inspection_fulfillment_id + matching source text on the two
--   split items. Their source_document_id stays as-is.
--   Line 3 (commented, choose one or neither): the older "Front tire replacement
--   (275/40 R20)" (Precision 11/2025) is the same job as "Replace both front tires".
--   Intentionally NOT touched: "Replace rear tires" (inspector's recommendation, not needed to
--   pass — it should stay open after the re-test).
--
-- ROLLBACK
--   UPDATE pending_work SET source_inspection_fulfillment_id = NULL, source = 'From uploaded document'
--   WHERE id IN ('2b37f78d-2ad4-4d80-84b0-f5f84cedfafd', 'dfd6e24f-f442-41dc-afc7-901ac30e687d');
--   (3a) UPDATE pending_work SET source_inspection_fulfillment_id = NULL WHERE id = 'd9cc235a-0d3a-4e62-b68c-5fcd7b8e2319';
--   (3b) UPDATE pending_work SET status = 'pending', completed_date = NULL,
--          notes = <previous notes> WHERE id = 'd9cc235a-0d3a-4e62-b68c-5fcd7b8e2319';

BEGIN;

-- 1. Replace both front tires
UPDATE pending_work
SET    source_inspection_fulfillment_id = '1931e91f-9009-42fa-aae6-c7d39fdd06de',
       source = 'Failed safety inspection 09/24/2026'
WHERE  id = '2b37f78d-2ad4-4d80-84b0-f5f84cedfafd'
  AND  source_inspection_fulfillment_id IS NULL
  AND  status NOT IN ('completed', 'cancelled');

-- 2. Repair parking brake
UPDATE pending_work
SET    source_inspection_fulfillment_id = '1931e91f-9009-42fa-aae6-c7d39fdd06de',
       source = 'Failed safety inspection 09/24/2026'
WHERE  id = 'dfd6e24f-f442-41dc-afc7-901ac30e687d'
  AND  source_inspection_fulfillment_id IS NULL
  AND  status NOT IN ('completed', 'cancelled');

-- 3a. OPTION (Joe chose 3a, 2026-10-12): keep the 11/2025 front-tire item but have the re-test close it too
UPDATE pending_work
SET    source_inspection_fulfillment_id = '1931e91f-9009-42fa-aae6-c7d39fdd06de'
WHERE  id = 'd9cc235a-0d3a-4e62-b68c-5fcd7b8e2319'
  AND  source_inspection_fulfillment_id IS NULL
  AND  status NOT IN ('completed', 'cancelled');

-- 3b. OPTION: cancel it now as a duplicate of "Replace both front tires"
--     (item 32 will later let you merge, keeping both sources on one item)
-- UPDATE pending_work
-- SET    status = 'cancelled',
--        completed_date = DATE '2026-10-12',
--        notes = coalesce(notes || E'\n', '') || 'Cancelled 2026-10-12: duplicate of "Replace both front tires" (failed safety inspection 09/24/2026).'
-- WHERE  id = 'd9cc235a-0d3a-4e62-b68c-5fcd7b8e2319'
--   AND  status NOT IN ('completed', 'cancelled');

-- Check: the re-test should now close the rows marked closes_on_pass
SELECT p.title, p.status, p.source,
       p.source_inspection_fulfillment_id = '1931e91f-9009-42fa-aae6-c7d39fdd06de' AS closes_on_pass
FROM   pending_work p
WHERE  p.id IN ('bfa1211c-6e48-484f-abec-48cf5a2f24d2', '2b37f78d-2ad4-4d80-84b0-f5f84cedfafd',
                'dfd6e24f-f442-41dc-afc7-901ac30e687d', 'd9cc235a-0d3a-4e62-b68c-5fcd7b8e2319',
                'e1f64a42-a40d-4064-a05c-8b59a6a6dc92')
ORDER  BY p.title;

COMMIT;
