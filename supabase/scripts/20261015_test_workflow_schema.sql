-- ═════════════════════════════════════════════════════════════════════════════
-- Test — item 32 phase 1 (migration 20261015_workflow_sources_sessions.sql)
--
-- Runs as a member (Joseph Limber) inside one DO block on back-dated 2019 TEST
-- rows, then RAISES the report as an error — which rolls back every test write.
-- NOTHING IS KEPT (no TEST rows, no change-log entries).
--
-- Run: npx supabase db query --linked -f supabase/scripts/20261015_test_workflow_schema.sql
-- Read the ERROR text: that's the report.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  member   uuid := '957df4e5-3706-4dbb-a641-4d99cd08990a';   -- Joseph Limber
  veh      uuid;
  insp     uuid;
  f_fail   uuid;
  f_pass   uuid;
  a        uuid;   -- item from the failed inspection (old column)
  b        uuid;   -- "split" piece: linked to the inspection source only
  c        uuid;   -- text-source item
  src      uuid;
  s1       uuid;
  s2       uuid;
  n        int;
  st       text;
  r        text := E'\n';
  ok       text := '  PASS  ';
  bad      text := '  FAIL  ';
BEGIN
  -- ── Backfill (as owner) ──
  SELECT count(*) INTO n FROM pending_work pw
  WHERE  pw.source_inspection_fulfillment_id IS NOT NULL
    AND  NOT EXISTS (SELECT 1 FROM pending_work_source_links l
                     JOIN pending_work_sources s ON s.id = l.source_id
                     WHERE l.pending_work_id = pw.id
                       AND s.inspection_fulfillment_id = pw.source_inspection_fulfillment_id);
  r := r || CASE WHEN n = 0 THEN ok ELSE bad END || format('every inspection item has its inspection source (%s missing)', n) || E'\n';

  SELECT count(*) INTO n FROM pending_work pw
  WHERE  NULLIF(btrim(pw.source), '') IS NOT NULL
    AND  NOT EXISTS (SELECT 1 FROM pending_work_source_links l WHERE l.pending_work_id = pw.id);
  r := r || CASE WHEN n = 0 THEN ok ELSE bad END || format('every item with a source text has a source link (%s missing)', n) || E'\n';

  -- Use The Rover's safety template; 2019 dates never become "latest"
  SELECT i.id, i.vehicle_id INTO insp, veh
  FROM   inspections i JOIN vehicles v ON v.id = i.vehicle_id
  WHERE  v.name = 'The Rover' AND i.inspection_type = 'safety';

  -- Become the member
  PERFORM set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ── Sources via the compatibility trigger ──
  INSERT INTO inspection_fulfillments (inspection_id, inspection_date, result, notes)
  VALUES (insp, DATE '2019-01-10', 'fail', 'TEST') RETURNING id INTO f_fail;

  INSERT INTO pending_work (vehicle_id, title, priority, status, identified_date, source, source_inspection_fulfillment_id)
  VALUES (veh, 'TEST repairs', 'high', 'pending', DATE '2019-01-10', 'Failed safety inspection 01/10/2019', f_fail)
  RETURNING id INTO a;

  SELECT s.id INTO src FROM pending_work_source_links l JOIN pending_work_sources s ON s.id = l.source_id
  WHERE  l.pending_work_id = a AND s.kind = 'inspection' AND s.inspection_fulfillment_id = f_fail;
  r := r || CASE WHEN src IS NOT NULL THEN ok ELSE bad END || 'new item from a failed inspection gets the inspection source' || E'\n';

  SELECT count(*) INTO n FROM pending_work_source_links l JOIN pending_work_sources s ON s.id = l.source_id
  WHERE  l.pending_work_id = a AND s.kind = 'note';
  r := r || CASE WHEN n = 0 THEN ok ELSE bad END || 'its "Failed safety inspection" text is not duplicated as a note' || E'\n';

  INSERT INTO pending_work (vehicle_id, title, priority, status, identified_date, source)
  VALUES (veh, 'TEST noted item', 'low', 'pending', DATE '2019-01-10', 'TEST person')
  RETURNING id INTO c;
  SELECT count(*) INTO n FROM pending_work_source_links l JOIN pending_work_sources s ON s.id = l.source_id
  WHERE  l.pending_work_id = c AND s.kind = 'note' AND s.label = 'TEST person';
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'free-text source becomes a note source' || E'\n';

  UPDATE pending_work SET source = 'TEST other person' WHERE id = c;
  SELECT string_agg(s.label, ',') INTO st FROM pending_work_source_links l JOIN pending_work_sources s ON s.id = l.source_id
  WHERE  l.pending_work_id = c;
  r := r || CASE WHEN st = 'TEST other person' THEN ok ELSE bad END || format('editing the text moves the note link (%s)', st) || E'\n';

  -- "Split" piece linked to the same source, no old column
  INSERT INTO pending_work (vehicle_id, title, priority, status, identified_date)
  VALUES (veh, 'TEST split piece', 'high', 'pending', DATE '2019-01-10') RETURNING id INTO b;
  INSERT INTO pending_work_source_links (pending_work_id, source_id) VALUES (b, src);

  -- ── Passing re-test closes both ──
  INSERT INTO inspection_fulfillments (inspection_id, inspection_date, result, notes)
  VALUES (insp, DATE '2019-01-20', 'pass', 'TEST') RETURNING id INTO f_pass;
  SELECT count(*) INTO n FROM pending_work WHERE id IN (a, b) AND status = 'completed';
  r := r || CASE WHEN n = 2 THEN ok ELSE bad END || format('passing re-test closes the original AND the split piece (%s of 2)', n) || E'\n';
  SELECT count(*) INTO n FROM pending_work WHERE id = c AND status = 'pending';
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'unrelated item stays open' || E'\n';

  -- ── Dependencies ──
  INSERT INTO pending_work_deps (pending_work_id, blocked_by_id, kind) VALUES (b, a, 'after');
  r := r || ok || 'can add "waiting on"' || E'\n';
  BEGIN
    INSERT INTO pending_work_deps (pending_work_id, blocked_by_id) VALUES (a, b);
    r := r || bad || 'a loop was allowed' || E'\n';
  EXCEPTION WHEN others THEN
    r := r || ok || 'a loop is refused: ' || SQLERRM || E'\n';
  END;

  -- ── Sessions ──
  INSERT INTO work_sessions (title, planned_date, assigned_to) VALUES ('TEST session', DATE '2019-02-01', member) RETURNING id INTO s1;
  INSERT INTO work_sessions (title, planned_date) VALUES ('TEST session 2', DATE '2019-02-08') RETURNING id INTO s2;
  INSERT INTO work_session_items (session_id, pending_work_id) VALUES (s1, c);
  r := r || ok || 'member can plan a session and add an item' || E'\n';

  BEGIN
    INSERT INTO work_session_items (session_id, pending_work_id) VALUES (s2, c);
    r := r || bad || 'item was planned in two sessions at once' || E'\n';
  EXCEPTION WHEN unique_violation THEN
    r := r || ok || 'an item can be in only one planned session' || E'\n';
  END;

  BEGIN
    UPDATE work_sessions SET status = 'closed' WHERE id = s1;
    r := r || bad || 'closed with an item lacking an outcome' || E'\n';
  EXCEPTION WHEN others THEN
    r := r || ok || 'closing is refused until every item has an outcome: ' || SQLERRM || E'\n';
  END;

  UPDATE work_session_items SET outcome = 'not_done', outcome_note = 'TEST parts late' WHERE session_id = s1;
  UPDATE work_sessions SET status = 'closed' WHERE id = s1;
  SELECT status INTO st FROM work_sessions WHERE id = s1 AND closed_at IS NOT NULL AND closed_by = member;
  r := r || CASE WHEN st = 'closed' THEN ok ELSE bad END || 'session closes once outcomes are set (closed_at/by filled)' || E'\n';

  INSERT INTO work_session_items (session_id, pending_work_id) VALUES (s2, c);
  r := r || ok || 'a "not done" item can be planned again in another session' || E'\n';

  BEGIN
    INSERT INTO work_session_items (session_id, pending_work_id) VALUES (s1, a);
    r := r || bad || 'item added to a closed session' || E'\n';
  EXCEPTION WHEN others THEN
    r := r || ok || 'cannot add to a closed session' || E'\n';
  END;

  UPDATE work_sessions SET status = 'cancelled' WHERE id = s2;
  SELECT outcome INTO st FROM work_session_items WHERE session_id = s2 AND pending_work_id = c;
  r := r || CASE WHEN st = 'not_done' THEN ok ELSE bad END || 'cancelling marks remaining items not done' || E'\n';

  -- ── Member delete rules ──
  DELETE FROM pending_work_deps WHERE pending_work_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'member can remove a "waiting on"' || E'\n';
  DELETE FROM pending_work_source_links WHERE pending_work_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'member can unlink a source' || E'\n';
  DELETE FROM work_sessions WHERE id = s1;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 0 THEN ok ELSE bad END || 'member cannot delete a session' || E'\n';
  DELETE FROM pending_work_sources WHERE id = src;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 0 THEN ok ELSE bad END || 'member cannot delete a source' || E'\n';

  RAISE EXCEPTION 'TEST REPORT (all writes rolled back):%', r;
END $$;
