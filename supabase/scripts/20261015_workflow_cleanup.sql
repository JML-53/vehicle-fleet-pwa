-- ═════════════════════════════════════════════════════════════════════════════
-- One-time data cleanup — item 32 phase 1 (after migration 20261015_workflow_sources_sessions.sql)
-- REVIEWED BY JOE BEFORE RUNNING. Sections marked (OPTIONAL) are commented out —
-- uncomment the ones you want. Run with:
--   npx supabase db query --linked -f supabase/scripts/20261015_workflow_cleanup.sql
--
--   A. Suburban: split "Repairs to pass safety inspection" → Emergency brake (Joseph) + Tires (Joe)
--   B. Gandalf: split the combined "NTB 05/18/2026 / Steve's 03/2023" source into the two real ones;
--      "Steve's Auto 03/08/2023 + owner" → Steve's Auto + Joe
--   C. "Waiting on" links already written in descriptions
--   D. Fix the one cut-off document source label
--   E. (OPTIONAL) Rover: retire the umbrella "Repairs to pass safety inspection" (its pieces exist)
--   F. (OPTIONAL) Rover: merge "Front tire replacement (275/40 R20)" into "Replace both front tires"
--
-- ROLLBACK notes per section below. Every change is also in the Changes page (as "System").
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── A. Suburban split ────────────────────────────────────────────────────────
-- The existing item (71b05fdf…) becomes piece 1, keeping its id, history, links and
-- its inspection source; piece 2 is a new item with the same source + due date.
-- ROLLBACK: UPDATE pending_work SET title = 'Repairs to pass safety inspection',
--             description = 'Emergency Brake and tires' WHERE id = '71b05fdf-bf05-4a38-8c90-c7441baddeb4';
--           DELETE FROM pending_work WHERE title = 'Tires' AND source_inspection_fulfillment_id =
--             (SELECT source_inspection_fulfillment_id FROM pending_work WHERE id = '71b05fdf-bf05-4a38-8c90-c7441baddeb4');

UPDATE pending_work
SET    title = 'Emergency brake',
       description = 'Failed safety inspection 09/19/2026 (split from "Repairs to pass safety inspection", which listed emergency brake and tires).'
WHERE  id = '71b05fdf-bf05-4a38-8c90-c7441baddeb4'
  AND  title = 'Repairs to pass safety inspection';          -- only once

INSERT INTO pending_work (vehicle_id, title, description, priority, status, identified_date, due_date,
                          source, source_inspection_fulfillment_id, assigned_shop_id, assigned_to, reported_by)
SELECT vehicle_id, 'Tires',
       'Failed safety inspection 09/19/2026 (split from "Repairs to pass safety inspection").',
       priority, 'pending', identified_date, due_date,
       source, source_inspection_fulfillment_id, assigned_shop_id,
       'f0c5fa1c-8e9d-4f95-87b4-e9b5ff60e3a5',                -- Joe
       reported_by
FROM   pending_work
WHERE  id = '71b05fdf-bf05-4a38-8c90-c7441baddeb4'
  AND  NOT EXISTS (SELECT 1 FROM pending_work t
                   WHERE t.title = 'Tires'
                     AND t.source_inspection_fulfillment_id = pending_work.source_inspection_fulfillment_id);
-- (the compatibility trigger links "Tires" to the inspection source automatically)


-- ── B. Gandalf sources ───────────────────────────────────────────────────────
-- ROLLBACK: re-link the two items to source 7f8049b3… (it is deleted below; recreate with
--           SELECT pending_source_id('note', <Gandalf id>, NULL, 'NTB 05/18/2026 / Steve''s 03/2023'))

-- Shocks (7eb4f6eb…) and control arms (2cddc338…): NTB 05/18/2026 + Steve's Auto 03/08/2023
INSERT INTO pending_work_source_links (pending_work_id, source_id)
SELECT pw, src
FROM   unnest(ARRAY['7eb4f6eb-c982-4117-81df-deb98cefb763', '2cddc338-1e3a-4a4c-b037-1f6712fda8e7']::uuid[]) pw
CROSS  JOIN unnest(ARRAY['ddad9158-2db5-4ee7-81d4-28d2421aeef6',   -- NTB 05/18/2026
                         'fe1f784f-5285-4d4f-b677-6364783c738e']::uuid[]) src   -- Steve's Auto 03/08/2023
ON CONFLICT DO NOTHING;

DELETE FROM pending_work_source_links WHERE source_id = '7f8049b3-1b85-42e3-adcf-8004a9dff24b';
DELETE FROM pending_work_sources      WHERE id        = '7f8049b3-1b85-42e3-adcf-8004a9dff24b';

-- Plugs & wires (c1cc259a…): Steve's Auto 03/08/2023 + Joe
INSERT INTO pending_work_source_links (pending_work_id, source_id)
VALUES ('c1cc259a-0aef-4273-8176-43847234a53c', 'fe1f784f-5285-4d4f-b677-6364783c738e'),
       ('c1cc259a-0aef-4273-8176-43847234a53c',
        pending_source_id('note', (SELECT vehicle_id FROM pending_work WHERE id = 'c1cc259a-0aef-4273-8176-43847234a53c'), NULL, 'Joe'))
ON CONFLICT DO NOTHING;

DELETE FROM pending_work_source_links WHERE source_id = 'ca000332-4435-437a-9d93-9904377272b6';
DELETE FROM pending_work_sources      WHERE id        = 'ca000332-4435-437a-9d93-9904377272b6';


-- ── C. "Waiting on" (from the descriptions) ──────────────────────────────────
-- ROLLBACK: DELETE FROM pending_work_deps WHERE pending_work_id IN (<the four ids below>);

INSERT INTO pending_work_deps (pending_work_id, blocked_by_id, kind) VALUES
  -- Gandalf: Wheel alignment — "Required after control arm work"
  ('abf49f20-dcbc-4074-a183-6d11867d0a4e', '2cddc338-1e3a-4a4c-b037-1f6712fda8e7', 'after'),
  -- Gandalf: Coil #3 — "Only if misfire on #3 continues after DIY spark plug & wire install"
  ('6ff33e1a-0fdd-4f8d-a96b-f59c4a390b48', 'c1cc259a-0aef-4273-8176-43847234a53c', 'only_if_fails'),
  -- Gandalf: Lifter monitoring — "Resolve spark plug/wire/coil first — if knock persists…"
  ('35ac377d-22b0-497d-ae47-fdfde650d5eb', '6ff33e1a-0fdd-4f8d-a96b-f59c4a390b48', 'only_if_fails'),
  -- Suburban: Registration renewal — "Must complete emissions first"
  ('37304c69-2585-4bee-b9bd-e96847d92d73', '32c11241-d81f-4542-825a-d757976b2fd9', 'after')
ON CONFLICT DO NOTHING;


-- ── D. Document label ────────────────────────────────────────────────────────

UPDATE pending_work_sources
SET    label = document_source_label(document_id)
WHERE  id = 'fb874fc8-e1a6-454a-bd5b-4b10e8ed77bc';


-- ── E. (OPTIONAL) Rover: retire the umbrella item ────────────────────────────
-- "Replace both front tires" and "Repair parking brake" now carry the inspection
-- source themselves, so the umbrella only duplicates them. Cancelling it changes
-- nothing about the re-test: the pieces still close on a pass.
-- ROLLBACK: UPDATE pending_work SET status = 'pending', completed_date = NULL WHERE id = 'bfa1211c-6e48-484f-abec-48cf5a2f24d2';

UPDATE pending_work
SET    status = 'cancelled', completed_date = DATE '2026-10-12',
       notes = coalesce(notes || E'\n', '') || 'Cancelled 2026-10-12: replaced by its pieces "Replace both front tires" and "Repair parking brake" (same inspection source).'
WHERE  id = 'bfa1211c-6e48-484f-abec-48cf5a2f24d2' AND status NOT IN ('completed', 'cancelled');


-- ── F. (OPTIONAL) Rover: merge the duplicate front-tire item ─────────────────
-- Keeps "Replace both front tires" (2b37f78d…, Joseph) and gives it the Precision
-- Motorcars 11/2025 source too; cancels "Front tire replacement (275/40 R20)" (d9cc235a…).
-- Copies the tire size into the kept item's description.
ROLLBACK: UPDATE pending_work SET status = 'pending', completed_date = NULL WHERE id = 'd9cc235a-0d3a-4e62-b68c-5fcd7b8e2319';
          DELETE FROM pending_work_source_links WHERE pending_work_id = '2b37f78d-2ad4-4d80-84b0-f5f84cedfafd'
            AND source_id = (SELECT id FROM pending_work_sources WHERE kind = 'note' AND label = 'Precision Motorcars 11/2025');
INSERT INTO pending_work_source_links (pending_work_id, source_id)
SELECT '2b37f78d-2ad4-4d80-84b0-f5f84cedfafd', l.source_id
FROM   pending_work_source_links l WHERE l.pending_work_id = 'd9cc235a-0d3a-4e62-b68c-5fcd7b8e2319'
ON CONFLICT DO NOTHING;
UPDATE pending_work
SET    description = coalesce(description || E'\n', '') || 'Size 275/40 R20 (Thule K-Summit K66 chains on file) — merged from the Precision Motorcars 11/2025 item.'
WHERE  id = '2b37f78d-2ad4-4d80-84b0-f5f84cedfafd';
UPDATE pending_work
SET    status = 'cancelled', completed_date = DATE '2026-10-12',
       notes = coalesce(notes || E'\n', '') || 'Merged 2026-10-12 into "Replace both front tires" (sources kept there).'
WHERE  id = 'd9cc235a-0d3a-4e62-b68c-5fcd7b8e2319' AND status NOT IN ('completed', 'cancelled');


-- ── Check ────────────────────────────────────────────────────────────────────
SELECT v.name AS vehicle, pw.title, pw.status, pw.due_date,
       (SELECT string_agg(s.label, ' + ' ORDER BY s.label) FROM pending_work_source_links l
          JOIN pending_work_sources s ON s.id = l.source_id WHERE l.pending_work_id = pw.id) AS sources,
       (SELECT string_agg(b.title || ' (' || d.kind || ')', ', ') FROM pending_work_deps d
          JOIN pending_work b ON b.id = d.blocked_by_id WHERE d.pending_work_id = pw.id) AS waiting_on
FROM   pending_work pw JOIN vehicles v ON v.id = pw.vehicle_id
WHERE  pw.status NOT IN ('completed', 'cancelled') AND v.name IN ('04 Suburban', 'Gandalf', 'The Rover')
ORDER  BY v.name, pw.title;

COMMIT;
