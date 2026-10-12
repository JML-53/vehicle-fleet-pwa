-- ═════════════════════════════════════════════════════════════════════════════
-- Item 32 phase 2a — split and merge pending work items, each in one transaction
--
--   split_pending_item(item, pieces jsonb) → uuid[]
--     pieces = [{title, assigned_to, priority, due_date, description?}, …] (≥ 2)
--     Piece 1 IS the original item (keeps id, history, links); the others are new
--     items that copy every source, the shop, the reporter and what it waits on.
--
--   merge_pending_items(keep, merge) → keep
--     Moves sources, service-record links, waiting-on (both directions) and a
--     planned session onto `keep`; keeps the higher priority and earlier due date;
--     cancels `merge` with a note.
--
-- SECURITY INVOKER (default): members' RLS applies — they may do both.
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.split_pending_item(p_item uuid, p_pieces jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  orig    pending_work;
  piece   jsonb;
  new_id  uuid;
  ids     uuid[] := ARRAY[p_item];
  n       int := 0;
BEGIN
  SELECT * INTO orig FROM pending_work WHERE id = p_item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending item not found';
  END IF;
  IF orig.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Only open items can be split';
  END IF;
  IF jsonb_typeof(p_pieces) IS DISTINCT FROM 'array' OR jsonb_array_length(p_pieces) < 2 THEN
    RAISE EXCEPTION 'A split needs at least two pieces';
  END IF;

  FOR piece IN SELECT value FROM jsonb_array_elements(p_pieces) LOOP
    n := n + 1;
    IF NULLIF(btrim(piece ->> 'title'), '') IS NULL THEN
      RAISE EXCEPTION 'Every piece needs a title (piece %)', n;
    END IF;

    IF n = 1 THEN
      UPDATE pending_work
      SET    title       = btrim(piece ->> 'title'),
             assigned_to = NULLIF(piece ->> 'assigned_to', '')::uuid,
             priority    = COALESCE(NULLIF(piece ->> 'priority', ''), orig.priority::text)::pending_priority,
             due_date    = NULLIF(piece ->> 'due_date', '')::date
      WHERE  id = p_item;
    ELSE
      INSERT INTO pending_work (
        vehicle_id, title, description, priority, status, identified_date, due_date,
        source, source_inspection_fulfillment_id, source_document_id,
        assigned_shop_id, assigned_to, reported_by)
      VALUES (
        orig.vehicle_id,
        btrim(piece ->> 'title'),
        COALESCE(NULLIF(btrim(piece ->> 'description'), ''),
                 format('Split from "%s".', orig.title) || COALESCE(E'\n' || orig.description, '')),
        COALESCE(NULLIF(piece ->> 'priority', ''), orig.priority::text)::pending_priority,
        'pending',
        orig.identified_date,
        NULLIF(piece ->> 'due_date', '')::date,
        orig.source, orig.source_inspection_fulfillment_id, orig.source_document_id,
        orig.assigned_shop_id,
        NULLIF(piece ->> 'assigned_to', '')::uuid,
        orig.reported_by)
      RETURNING id INTO new_id;

      -- Every source of the original (the compatibility trigger may already have added some)
      INSERT INTO pending_work_source_links (pending_work_id, source_id)
      SELECT new_id, source_id FROM pending_work_source_links WHERE pending_work_id = p_item
      ON CONFLICT DO NOTHING;

      -- …and whatever the original was waiting on
      INSERT INTO pending_work_deps (pending_work_id, blocked_by_id, kind)
      SELECT new_id, blocked_by_id, kind FROM pending_work_deps WHERE pending_work_id = p_item
      ON CONFLICT DO NOTHING;

      ids := ids || new_id;
    END IF;
  END LOOP;

  RETURN ids;
END;
$$;


CREATE OR REPLACE FUNCTION public.merge_pending_items(p_keep uuid, p_merge uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  k pending_work;
  m pending_work;
BEGIN
  IF p_keep = p_merge THEN
    RAISE EXCEPTION 'Pick a different item to merge';
  END IF;
  SELECT * INTO k FROM pending_work WHERE id = p_keep;
  SELECT * INTO m FROM pending_work WHERE id = p_merge;
  IF k.id IS NULL OR m.id IS NULL THEN
    RAISE EXCEPTION 'Pending item not found';
  END IF;
  IF k.vehicle_id <> m.vehicle_id THEN
    RAISE EXCEPTION 'Only items on the same vehicle can be merged';
  END IF;
  IF k.status IN ('completed', 'cancelled') OR m.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Only open items can be merged';
  END IF;

  -- Sources
  INSERT INTO pending_work_source_links (pending_work_id, source_id)
  SELECT p_keep, source_id FROM pending_work_source_links WHERE pending_work_id = p_merge
  ON CONFLICT DO NOTHING;

  -- What it waits on, and what waits on it
  INSERT INTO pending_work_deps (pending_work_id, blocked_by_id, kind)
  SELECT p_keep, blocked_by_id, kind FROM pending_work_deps
  WHERE  pending_work_id = p_merge AND blocked_by_id <> p_keep
  ON CONFLICT DO NOTHING;
  INSERT INTO pending_work_deps (pending_work_id, blocked_by_id, kind)
  SELECT pending_work_id, p_keep, kind FROM pending_work_deps
  WHERE  blocked_by_id = p_merge AND pending_work_id <> p_keep
  ON CONFLICT DO NOTHING;
  DELETE FROM pending_work_deps WHERE pending_work_id = p_merge OR blocked_by_id = p_merge;

  -- A planned session: moves over unless `keep` is already planned somewhere
  IF EXISTS (SELECT 1 FROM work_session_items WHERE pending_work_id = p_keep AND outcome IS NULL) THEN
    DELETE FROM work_session_items WHERE pending_work_id = p_merge AND outcome IS NULL;
  ELSE
    UPDATE work_session_items SET pending_work_id = p_keep
    WHERE  pending_work_id = p_merge AND outcome IS NULL
      AND  NOT EXISTS (SELECT 1 FROM work_session_items x
                       WHERE x.session_id = work_session_items.session_id AND x.pending_work_id = p_keep);
    DELETE FROM work_session_items WHERE pending_work_id = p_merge AND outcome IS NULL;
  END IF;

  -- Keep the more urgent priority (enum order: high … conditional) and the earlier dates
  UPDATE pending_work
  SET    priority        = LEAST(k.priority, m.priority),
         due_date        = CASE WHEN k.due_date IS NULL THEN m.due_date
                                WHEN m.due_date IS NULL THEN k.due_date
                                ELSE LEAST(k.due_date, m.due_date) END,
         identified_date = CASE WHEN k.identified_date IS NULL THEN m.identified_date
                                WHEN m.identified_date IS NULL THEN k.identified_date
                                ELSE LEAST(k.identified_date, m.identified_date) END,
         assigned_to     = COALESCE(k.assigned_to, m.assigned_to),
         assigned_shop_id = COALESCE(k.assigned_shop_id, m.assigned_shop_id),
         description     = COALESCE(k.description || E'\n\n', '')
                           || format('Merged from "%s"', m.title)
                           || COALESCE(': ' || m.description, '.')
  WHERE  id = p_keep;

  -- Cancel the duplicate first, then move its service-record links
  -- (sync_pending_status leaves cancelled items alone)
  UPDATE pending_work
  SET    status = 'cancelled', completed_date = current_date,
         notes  = COALESCE(notes || E'\n', '') || format('Merged %s into "%s".', to_char(current_date, 'MM/DD/YYYY'), k.title)
  WHERE  id = p_merge;

  INSERT INTO pending_work_links (pending_work_id, service_record_id, resolves, notes)
  SELECT p_keep, service_record_id, resolves, notes FROM pending_work_links WHERE pending_work_id = p_merge
  ON CONFLICT (pending_work_id, service_record_id) DO NOTHING;
  DELETE FROM pending_work_links WHERE pending_work_id = p_merge;

  RETURN p_keep;
END;
$$;

GRANT EXECUTE ON FUNCTION public.split_pending_item(uuid, jsonb)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_pending_items(uuid, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.pending_source_id(text, uuid, uuid, text, date) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- Test: supabase/scripts/20261016_test_split_merge.sql (rolls itself back)
-- ═════════════════════════════════════════════════════════════════════════════
