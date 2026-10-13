-- ═════════════════════════════════════════════════════════════════════════════
-- Test — item 32 phase 2b close-out (migration 20261017_work_session_close.sql)
-- Runs as Joseph on 2019 TEST rows (Rufus + R2), then RAISES the report → all rolled back.
-- Run: npx supabase db query --linked -f supabase/scripts/20261017_test_session_close.sql
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  member  uuid := '957df4e5-3706-4dbb-a641-4d99cd08990a';   -- Joseph Limber
  v1      uuid;   -- Rufus: visit
  v2      uuid;   -- R2: nothing logged, only a finding
  shop    uuid;
  s1      uuid;
  s2      uuid;
  i_done  uuid;  i_part uuid;  i_split uuid;  i_not uuid;  i_drop uuid;  i_v2 uuid;
  si_done uuid;  si_part uuid; si_split uuid; si_not uuid; si_drop uuid; si_v2 uuid;
  res     jsonb;
  visit   uuid;
  n       int;
  st      text;
  r       text := E'\n';
  ok      text := '  PASS  ';
  bad     text := '  FAIL  ';
BEGIN
  SELECT id INTO v1 FROM vehicles WHERE name = 'Rufus (91 YJ)';
  SELECT id INTO v2 FROM vehicles WHERE name = 'R2';
  SELECT id INTO shop FROM shops WHERE name = 'NTB';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO pending_work (vehicle_id, title, priority, status, source) VALUES (v1, 'TEST done',  'high', 'pending', 'TEST src') RETURNING id INTO i_done;
  INSERT INTO pending_work (vehicle_id, title, priority, status, source) VALUES (v1, 'TEST part',  'high', 'pending', 'TEST src') RETURNING id INTO i_part;
  INSERT INTO pending_work (vehicle_id, title, priority, status, source) VALUES (v1, 'TEST split', 'high', 'pending', 'TEST src') RETURNING id INTO i_split;
  INSERT INTO pending_work (vehicle_id, title, priority, status, source) VALUES (v1, 'TEST not',   'low',  'pending', 'TEST src') RETURNING id INTO i_not;
  INSERT INTO pending_work (vehicle_id, title, priority, status, source) VALUES (v1, 'TEST drop',  'low',  'pending', 'TEST src') RETURNING id INTO i_drop;
  INSERT INTO pending_work (vehicle_id, title, priority, status, source) VALUES (v2, 'TEST r2',    'low',  'pending', 'TEST src') RETURNING id INTO i_v2;

  INSERT INTO work_sessions (title, planned_date, assigned_to, shop_id) VALUES ('TEST trip', DATE '2019-07-06', member, shop) RETURNING id INTO s1;
  INSERT INTO work_sessions (title, planned_date) VALUES ('TEST next trip', DATE '2019-07-13') RETURNING id INTO s2;
  INSERT INTO work_session_items (session_id, pending_work_id) VALUES (s1, i_done)  RETURNING id INTO si_done;
  INSERT INTO work_session_items (session_id, pending_work_id) VALUES (s1, i_part)  RETURNING id INTO si_part;
  INSERT INTO work_session_items (session_id, pending_work_id) VALUES (s1, i_split) RETURNING id INTO si_split;
  INSERT INTO work_session_items (session_id, pending_work_id) VALUES (s1, i_not)   RETURNING id INTO si_not;
  INSERT INTO work_session_items (session_id, pending_work_id) VALUES (s1, i_drop)  RETURNING id INTO si_drop;
  INSERT INTO work_session_items (session_id, pending_work_id) VALUES (s1, i_v2)    RETURNING id INTO si_v2;

  -- Missing an outcome → refused, nothing saved
  BEGIN
    PERFORM close_work_session(s1, jsonb_build_object('vehicles', jsonb_build_array(
      jsonb_build_object('vehicle_id', v1, 'items', jsonb_build_array(
        jsonb_build_object('session_item_id', si_done, 'outcome', 'done'))))));
    r := r || bad || 'closed with items lacking an outcome' || E'\n';
  EXCEPTION WHEN others THEN
    r := r || ok || 'refused while items lack an outcome: ' || SQLERRM || E'\n';
  END;
  SELECT count(*) INTO n FROM service_visits WHERE work_session_id = s1;
  r := r || CASE WHEN n = 0 THEN ok ELSE bad END || 'a refused close-out saves nothing (no visit)' || E'\n';

  res := close_work_session(s1, jsonb_build_object('vehicles', jsonb_build_array(
    jsonb_build_object(
      'vehicle_id', v1,
      'visit', jsonb_build_object('visit_date', '2019-07-06', 'mileage', '12345', 'shop_id', shop, 'total_cost', '400'),
      'items', jsonb_build_array(
        jsonb_build_object('session_item_id', si_done,  'outcome', 'done',    'record', jsonb_build_object('title', 'TEST done record', 'category', 'tires', 'total_cost', '300')),
        jsonb_build_object('session_item_id', si_part,  'outcome', 'partial', 'note', 'TEST rear pair', 'record', jsonb_build_object('title', 'TEST part record'),
                           'next', jsonb_build_object('kind', 'session', 'session_id', s2)),
        jsonb_build_object('session_item_id', si_split, 'outcome', 'partial', 'note', 'TEST the rest', 'next', jsonb_build_object('kind', 'split')),
        jsonb_build_object('session_item_id', si_not,   'outcome', 'not_done', 'note', 'TEST parts late'),
        jsonb_build_object('session_item_id', si_drop,  'outcome', 'dropped',  'note', 'TEST not needed')),
      'extra_records', jsonb_build_array(jsonb_build_object('title', 'TEST unplanned rotation', 'category', 'tires')),
      'findings', jsonb_build_array(jsonb_build_object('title', 'TEST torn CV boot', 'priority', 'medium', 'session_id', s2))),
    jsonb_build_object(
      'vehicle_id', v2,
      'items', jsonb_build_array(jsonb_build_object('session_item_id', si_v2, 'outcome', 'not_done',
                                 'next', jsonb_build_object('kind', 'session', 'session_id', s2))),
      'findings', jsonb_build_array(jsonb_build_object('title', 'TEST r2 finding'))))));

  SELECT status INTO st FROM work_sessions WHERE id = s1;
  r := r || CASE WHEN st = 'closed' THEN ok ELSE bad END || 'session closed' || E'\n';

  SELECT count(*) INTO n FROM service_visits WHERE work_session_id = s1;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || format('one visit (Rufus only; R2 logged nothing): %s', n) || E'\n';
  SELECT id INTO visit FROM service_visits WHERE work_session_id = s1;
  SELECT visit_type::text INTO st FROM service_visits WHERE id = visit;
  r := r || CASE WHEN st = 'shop' THEN ok ELSE bad END || 'visit type shop (NTB)' || E'\n';
  SELECT count(*) INTO n FROM mileage_log WHERE service_visit_id = visit AND mileage = 12345;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'mileage logged on the visit' || E'\n';
  SELECT count(*) INTO n FROM service_records WHERE visit_id = visit;
  r := r || CASE WHEN n = 4 THEN ok ELSE bad END || format('records: done + part + split + unplanned = %s', n) || E'\n';
  r := r || CASE WHEN jsonb_array_length(res -> 'records') = 4 THEN ok ELSE bad END || 'returns the 4 new records (for maintenance matching)' || E'\n';

  SELECT status::text INTO st FROM pending_work WHERE id = i_done;
  r := r || CASE WHEN st = 'completed' THEN ok ELSE bad END || format('done → completed (%s)', st) || E'\n';
  SELECT status::text INTO st FROM pending_work WHERE id = i_part;
  r := r || CASE WHEN st = 'in_progress' THEN ok ELSE bad END || format('partly done → stays open, in progress (%s)', st) || E'\n';
  SELECT count(*) INTO n FROM pending_work WHERE id = i_part AND notes LIKE '%left: TEST rear pair%';
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || '"what''s left" noted on the item' || E'\n';
  SELECT count(*) INTO n FROM work_session_items WHERE session_id = s2 AND pending_work_id = i_part AND outcome IS NULL;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'partly done item moved into the next session' || E'\n';
  SELECT status::text INTO st FROM pending_work WHERE id = i_split;
  r := r || CASE WHEN st = 'completed' THEN ok ELSE bad END || format('split: done part resolves the item (%s)', st) || E'\n';
  SELECT count(*) INTO n FROM pending_work p WHERE p.title = 'TEST the rest'
    AND EXISTS (SELECT 1 FROM pending_work_source_links l JOIN pending_work_sources s ON s.id = l.source_id
                WHERE l.pending_work_id = p.id AND s.label = 'TEST src');
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'split: the rest is a new item with the same source' || E'\n';
  SELECT status::text INTO st FROM pending_work WHERE id = i_not;
  r := r || CASE WHEN st = 'pending' THEN ok ELSE bad END || format('not done → still pending, back in the lane (%s)', st) || E'\n';
  SELECT outcome || ':' || outcome_note INTO st FROM work_session_items WHERE id = si_not;
  r := r || CASE WHEN st = 'not_done:TEST parts late' THEN ok ELSE bad END || 'session keeps "not done" + reason' || E'\n';
  SELECT status::text INTO st FROM pending_work WHERE id = i_drop;
  r := r || CASE WHEN st = 'cancelled' THEN ok ELSE bad END || format('no longer needed → cancelled (%s)', st) || E'\n';

  SELECT s.kind || ':' || s.label INTO st FROM pending_work p
    JOIN pending_work_source_links l ON l.pending_work_id = p.id JOIN pending_work_sources s ON s.id = l.source_id
  WHERE p.title = 'TEST torn CV boot';
  r := r || CASE WHEN st = 'service_visit:NTB visit 07/06/2019' THEN ok ELSE bad END || format('Rufus finding → source = the visit (%s)', st) || E'\n';
  SELECT count(*) INTO n FROM pending_work p JOIN work_session_items w ON w.pending_work_id = p.id
  WHERE p.title = 'TEST torn CV boot' AND w.session_id = s2;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'finding planned straight into the next session' || E'\n';
  SELECT s.kind INTO st FROM pending_work p
    JOIN pending_work_source_links l ON l.pending_work_id = p.id JOIN pending_work_sources s ON s.id = l.source_id
  WHERE p.title = 'TEST r2 finding';
  r := r || CASE WHEN st = 'work_session' THEN ok ELSE bad END || format('R2 finding (nothing logged) → "Found during" source (%s)', st) || E'\n';

  BEGIN
    PERFORM close_work_session(s1, '{}'::jsonb);
    r := r || bad || 'closed twice' || E'\n';
  EXCEPTION WHEN others THEN r := r || ok || 'cannot close twice: ' || SQLERRM || E'\n';
  END;

  RAISE EXCEPTION 'TEST REPORT (all writes rolled back):%', r;
END $$;
