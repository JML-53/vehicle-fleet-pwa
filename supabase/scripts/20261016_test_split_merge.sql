-- ═════════════════════════════════════════════════════════════════════════════
-- Test — item 32 phase 2a split/merge (migration 20261016_workflow_split_merge.sql)
-- Runs as Joseph on 2019 TEST rows, then RAISES the report → everything rolls back.
-- Run: npx supabase db query --linked -f supabase/scripts/20261016_test_split_merge.sql
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  member uuid := '957df4e5-3706-4dbb-a641-4d99cd08990a';   -- Joseph Limber
  joe    uuid := 'f0c5fa1c-8e9d-4f95-87b4-e9b5ff60e3a5';
  veh    uuid;
  insp   uuid;
  f_fail uuid;
  orig   uuid;
  blk    uuid;
  dup    uuid;
  ids    uuid[];
  n      int;
  st     text;
  r      text := E'\n';
  ok     text := '  PASS  ';
  bad    text := '  FAIL  ';
BEGIN
  SELECT i.id, i.vehicle_id INTO insp, veh
  FROM   inspections i JOIN vehicles v ON v.id = i.vehicle_id
  WHERE  v.name = '04 Suburban' AND i.inspection_type = 'safety';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO inspection_fulfillments (inspection_id, inspection_date, result, notes)
  VALUES (insp, DATE '2019-03-01', 'fail', 'TEST') RETURNING id INTO f_fail;
  INSERT INTO pending_work (vehicle_id, title, description, priority, status, identified_date, due_date,
                            source, source_inspection_fulfillment_id)
  VALUES (veh, 'TEST repairs', 'brake and tires', 'high', 'pending', DATE '2019-03-01', DATE '2019-03-16',
          'TEST shop note', f_fail)
  RETURNING id INTO orig;
  INSERT INTO pending_work (vehicle_id, title, priority, status) VALUES (veh, 'TEST blocker', 'low', 'pending') RETURNING id INTO blk;
  INSERT INTO pending_work_deps (pending_work_id, blocked_by_id) VALUES (orig, blk);

  -- ── Split ──
  ids := split_pending_item(orig, jsonb_build_array(
    jsonb_build_object('title', 'TEST e-brake', 'assigned_to', member, 'priority', 'high', 'due_date', '2019-03-16'),
    jsonb_build_object('title', 'TEST tires',   'assigned_to', joe,    'priority', 'medium', 'due_date', '2019-03-16')));
  r := r || CASE WHEN array_length(ids, 1) = 2 AND ids[1] = orig THEN ok ELSE bad END || 'split returns the original + 1 new item' || E'\n';

  SELECT title INTO st FROM pending_work WHERE id = orig;
  r := r || CASE WHEN st = 'TEST e-brake' THEN ok ELSE bad END || 'piece 1 is the original, retitled' || E'\n';

  SELECT count(*) INTO n FROM pending_work_source_links WHERE pending_work_id = ids[2];
  r := r || CASE WHEN n = 2 THEN ok ELSE bad END || format('new piece has both sources (inspection + note): %s', n) || E'\n';

  SELECT count(*) INTO n FROM pending_work_deps WHERE pending_work_id = ids[2] AND blocked_by_id = blk;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'new piece waits on the same item' || E'\n';

  SELECT count(*) INTO n FROM pending_work WHERE id = ids[2] AND assigned_to = joe AND priority = 'medium' AND description LIKE 'Split from "TEST repairs".%';
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'new piece: own assignee + priority, description says where it came from' || E'\n';

  BEGIN
    PERFORM split_pending_item(orig, jsonb_build_array(jsonb_build_object('title', 'only one')));
    r := r || bad || 'one-piece split allowed' || E'\n';
  EXCEPTION WHEN others THEN r := r || ok || 'a split needs two pieces: ' || SQLERRM || E'\n';
  END;

  -- ── Passing re-test closes both pieces ──
  INSERT INTO inspection_fulfillments (inspection_id, inspection_date, result, notes)
  VALUES (insp, DATE '2019-03-10', 'pass', 'TEST');
  SELECT count(*) INTO n FROM pending_work WHERE id = ANY (ids) AND status = 'completed';
  r := r || CASE WHEN n = 2 THEN ok ELSE bad END || format('passing re-test closes both pieces (%s of 2)', n) || E'\n';

  -- ── Merge ──
  INSERT INTO pending_work (vehicle_id, title, priority, status, due_date, source)
  VALUES (veh, 'TEST keep', 'medium', 'pending', DATE '2019-05-01', 'TEST source A') RETURNING id INTO orig;
  INSERT INTO pending_work (vehicle_id, title, description, priority, status, due_date, source)
  VALUES (veh, 'TEST dup', 'size 275', 'high', 'pending', DATE '2019-04-01', 'TEST source B') RETURNING id INTO dup;
  INSERT INTO pending_work_deps (pending_work_id, blocked_by_id) VALUES (blk, dup);   -- blocker now waits on dup

  PERFORM merge_pending_items(orig, dup);

  SELECT count(*) INTO n FROM pending_work_source_links WHERE pending_work_id = orig;
  r := r || CASE WHEN n = 2 THEN ok ELSE bad END || format('kept item has both sources: %s', n) || E'\n';
  SELECT priority::text || ' ' || due_date::text INTO st FROM pending_work WHERE id = orig;
  r := r || CASE WHEN st = 'high 2019-04-01' THEN ok ELSE bad END || format('keeps higher priority + earlier due date (%s)', st) || E'\n';
  SELECT status::text INTO st FROM pending_work WHERE id = dup;
  r := r || CASE WHEN st = 'cancelled' THEN ok ELSE bad END || 'duplicate cancelled' || E'\n';
  SELECT count(*) INTO n FROM pending_work_deps WHERE pending_work_id = blk AND blocked_by_id = orig;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || '"waiting on the duplicate" moved to the kept item' || E'\n';
  SELECT count(*) INTO n FROM pending_work WHERE id = orig AND description LIKE '%Merged from "TEST dup": size 275%';
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'description notes the merge' || E'\n';

  RAISE EXCEPTION 'TEST REPORT (all writes rolled back):%', r;
END $$;
