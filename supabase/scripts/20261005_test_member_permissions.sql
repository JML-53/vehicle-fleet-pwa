-- ═════════════════════════════════════════════════════════════════════════════
-- Member-permission test (migration 20261005_family_access.sql)
--
-- Impersonates a member (Joseph Limber) inside one DO block, tries each rule,
-- then RAISES the report as an error — which rolls back every test write.
-- NOTHING IS KEPT. Expect the editor to show an "error": that's the report.
--
-- HOW TO RUN: Supabase → SQL Editor → paste → Run. Read the ERROR text.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  member uuid := '957df4e5-3706-4dbb-a641-4d99cd08990a';   -- Joseph Limber
  rec    uuid;
  veh    uuid;
  rm     uuid;
  part   uuid;
  dr     uuid;
  n      int;
  st     text;
  r      text := E'\n';
  ok     text := '  PASS  ';
  bad    text := '  FAIL  ';
BEGIN
  SELECT id, vehicle_id INTO rec, veh FROM service_records ORDER BY created_at LIMIT 1;
  SELECT id INTO rm FROM roadmap_items WHERE status = 'approved' LIMIT 1;

  -- Become the member
  PERFORM set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  r := r || CASE WHEN NOT is_admin() THEN ok ELSE bad END || 'is_admin() is false for member' || E'\n';

  -- Read + edit allowed
  SELECT count(*) INTO n FROM service_records;
  r := r || CASE WHEN n > 0 THEN ok ELSE bad END || format('can read service_records (%s rows)', n) || E'\n';

  UPDATE service_records SET notes = notes WHERE id = rec;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'can edit a service record' || E'\n';

  -- Delete blocked on primary entities (RLS filters → 0 rows, no error)
  DELETE FROM service_records WHERE id = rec;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 0 THEN ok ELSE bad END || 'cannot delete a service record' || E'\n';

  DELETE FROM vehicles WHERE id = veh;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 0 THEN ok ELSE bad END || 'cannot delete a vehicle' || E'\n';

  -- Child rows still deletable (normal editing)
  INSERT INTO parts (service_record_id, part_name, quantity) VALUES (rec, 'TEST part', 1) RETURNING id INTO part;
  DELETE FROM parts WHERE id = part;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'can add + remove a part' || E'\n';

  -- Deletion requests: can file, cannot approve
  INSERT INTO deletion_requests (table_name, row_id, vehicle_id, reason, requested_by)
  VALUES ('service_records', rec::text, veh, 'TEST', member) RETURNING id INTO dr;
  r := r || ok || 'can file a deletion request' || E'\n';
  UPDATE deletion_requests SET status = 'approved' WHERE id = dr;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 0 THEN ok ELSE bad END || 'cannot approve a deletion request' || E'\n';

  -- Roadmap: insert forced to new/medium; status change rejected
  INSERT INTO roadmap_items (group_name, item_number, title, status, priority)
  VALUES ('enhancement', 'TEST', 'TEST item', 'approved', 'high') RETURNING status INTO st;
  r := r || CASE WHEN st = 'new' THEN ok ELSE bad END || format('new roadmap item forced to status=%s', st) || E'\n';

  UPDATE roadmap_items SET title = title WHERE id = rm;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 1 THEN ok ELSE bad END || 'can edit roadmap content' || E'\n';

  BEGIN
    UPDATE roadmap_items SET status = 'new' WHERE id = rm;
    r := r || bad || 'roadmap status change was allowed' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || ok || 'roadmap status change rejected' || E'\n';
  END;

  -- Profiles: can't self-promote
  BEGIN
    UPDATE profiles SET role = 'admin' WHERE id = member;
    GET DIAGNOSTICS n = ROW_COUNT;
    r := r || CASE WHEN n = 0 THEN ok ELSE bad END || format('self-promotion blocked (%s rows)', n) || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || ok || 'self-promotion to admin rejected' || E'\n';
  END;

  -- audit_log is read-only
  BEGIN
    INSERT INTO audit_log (table_name, op) VALUES ('x', 'INSERT');
    r := r || bad || 'member could write audit_log' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || ok || 'audit_log not writable' || E'\n';
  END;

  -- Change attribution
  SELECT count(*) INTO n FROM audit_log WHERE changed_by = member;
  r := r || CASE WHEN n > 0 THEN ok ELSE bad END || format('member changes attributed in audit_log (%s rows)', n) || E'\n';

  RAISE EXCEPTION 'MEMBER PERMISSION REPORT (all changes rolled back):%', r;
END $$;
