-- ═════════════════════════════════════════════════════════════════════════════
-- Item 32 phase 2b — close out a work session in one transaction
--
--   close_work_session(session, payload jsonb) → jsonb
--
--   payload = { vehicles: [{
--     vehicle_id,
--     visit:   { visit_date, mileage, shop_id, total_cost, notes },
--     items:   [{ session_item_id, outcome: done|partial|not_done|dropped, note,
--                 record: { title, category, total_cost },          -- done / partial
--                 next:   { kind: lane|session|split, session_id } }],  -- partial / not_done
--     extra_records: [{ title, category, total_cost }],              -- work not on the plan
--     findings:      [{ title, description, priority, assigned_to, due_date, session_id }]
--   }] }
--
--   Per vehicle: a service visit (work_session_id = this session) only when
--   something was logged; mileage; one record per done/partial item linked
--   resolves = true (done) / false (partial, stays open); dropped → cancelled;
--   partial "split" → the done part resolves the item and the rest becomes a
--   new item with the same sources; not done / partial → back to the person's
--   Later list or into another planned session. New findings get ONE new
--   source per vehicle: the visit just logged, or "Found during <session>".
--   Finally the session is closed — the status guard refuses if any item of
--   the session still has no outcome.
--
--   Returns { visits: [...], records: [{id, vehicle_id, title, category}], new_items: [...] }
--   (the app then applies maintenance auto-matching to the new records, as the visit form does).
--
-- SECURITY INVOKER (default): members' RLS applies. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.close_work_session(p_session uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s          work_sessions;
  v          jsonb;
  it         jsonb;
  f          jsonb;
  r          jsonb;
  nxt        jsonb;
  si         work_session_items;
  pw         pending_work;
  sh         shops;
  v_vehicle  uuid;
  v_date     date;
  v_visit    uuid;
  v_rec      uuid;
  v_new      uuid;
  v_src      uuid;
  v_outcome  text;
  v_note     text;
  out_visits  jsonb := '[]';
  out_records jsonb := '[]';
  out_items   jsonb := '[]';
BEGIN
  SELECT * INTO s FROM work_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF s.status <> 'planned' THEN
    RAISE EXCEPTION 'This session is already %', s.status;
  END IF;

  FOR v IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload -> 'vehicles', '[]')) LOOP
    v_vehicle := (v ->> 'vehicle_id')::uuid;
    v_date    := COALESCE(NULLIF(v #>> '{visit,visit_date}', '')::date, s.planned_date, current_date);
    v_visit   := NULL;
    sh        := NULL;
    SELECT * INTO sh FROM shops WHERE id = NULLIF(v #>> '{visit,shop_id}', '')::uuid;

    -- ── A visit only when something is logged (done/partial on an item still open) ──
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v -> 'items', '[]')) x
               JOIN work_session_items w ON w.id = (x.value ->> 'session_item_id')::uuid
               JOIN pending_work p ON p.id = w.pending_work_id
               WHERE x.value ->> 'outcome' IN ('done', 'partial') AND p.status NOT IN ('completed', 'cancelled'))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v -> 'extra_records', '[]')) x
                  WHERE NULLIF(btrim(x.value ->> 'title'), '') IS NOT NULL) THEN
      INSERT INTO service_visits (vehicle_id, title, visit_date, visit_type, shop_id, total_cost, notes, work_session_id)
      VALUES (v_vehicle, s.title, v_date,
              (CASE WHEN sh.id IS NULL OR sh.is_self THEN 'self' ELSE 'shop' END)::visit_type,
              sh.id,
              NULLIF(v #>> '{visit,total_cost}', '')::numeric,
              NULLIF(btrim(v #>> '{visit,notes}'), ''),
              p_session)
      RETURNING id INTO v_visit;
      out_visits := out_visits || jsonb_build_object('vehicle_id', v_vehicle, 'visit_id', v_visit);

      IF NULLIF(v #>> '{visit,mileage}', '') IS NOT NULL THEN
        INSERT INTO mileage_log (vehicle_id, recorded_date, mileage, source, service_visit_id)
        VALUES (v_vehicle, v_date, (v #>> '{visit,mileage}')::int, 'service_visit', v_visit);
      END IF;
    END IF;

    -- ── Planned items ──
    FOR it IN SELECT value FROM jsonb_array_elements(COALESCE(v -> 'items', '[]')) LOOP
      SELECT * INTO si FROM work_session_items
      WHERE  id = (it ->> 'session_item_id')::uuid AND session_id = p_session;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'An item is not part of this session';
      END IF;
      SELECT * INTO pw FROM pending_work WHERE id = si.pending_work_id;
      IF pw.vehicle_id <> v_vehicle THEN
        RAISE EXCEPTION '"%" belongs to another vehicle', pw.title;
      END IF;

      v_outcome := it ->> 'outcome';
      IF v_outcome IS NULL OR v_outcome NOT IN ('done', 'partial', 'not_done', 'dropped') THEN
        RAISE EXCEPTION '"%" needs an outcome', pw.title;
      END IF;
      v_note := NULLIF(btrim(it ->> 'note'), '');
      nxt    := COALESCE(it -> 'next', '{}');
      v_rec  := NULL;

      -- Already completed elsewhere (e.g. "Done, nothing to log" before close-out): no second record
      IF v_outcome IN ('done', 'partial') AND pw.status NOT IN ('completed', 'cancelled') THEN
        r := COALESCE(it -> 'record', '{}');
        INSERT INTO service_records (vehicle_id, visit_id, service_date, category, title, total_cost, source)
        VALUES (v_vehicle, v_visit, v_date,
                COALESCE(NULLIF(r ->> 'category', ''), 'other')::service_category,
                COALESCE(NULLIF(btrim(r ->> 'title'), ''), pw.title),
                NULLIF(r ->> 'total_cost', '')::numeric,
                'manual')
        RETURNING id INTO v_rec;
        out_records := out_records || (SELECT jsonb_build_object('id', id, 'vehicle_id', vehicle_id, 'title', title, 'category', category)
                                       FROM service_records WHERE id = v_rec);

        -- done → resolves; partial → worked on (stays open) unless the rest is split off
        INSERT INTO pending_work_links (pending_work_id, service_record_id, resolves, notes)
        VALUES (pw.id, v_rec, v_outcome = 'done' OR nxt ->> 'kind' = 'split', format('Session "%s"', s.title));

        IF v_outcome = 'partial' AND v_note IS NOT NULL AND nxt ->> 'kind' IS DISTINCT FROM 'split' THEN
          UPDATE pending_work
          SET    notes = COALESCE(notes || E'\n', '') || format('Partly done %s (session "%s") — left: %s',
                                                                to_char(v_date, 'MM/DD/YYYY'), s.title, v_note)
          WHERE  id = pw.id;
        END IF;
      ELSIF v_outcome = 'dropped' AND pw.status NOT IN ('completed', 'cancelled') THEN
        UPDATE pending_work
        SET    status = 'cancelled', completed_date = v_date,
               notes  = COALESCE(notes || E'\n', '') || format('No longer needed %s (session "%s")%s',
                          to_char(v_date, 'MM/DD/YYYY'), s.title, COALESCE(': ' || v_note, '.'))
        WHERE  id = pw.id;
      END IF;

      UPDATE work_session_items
      SET    outcome = v_outcome, outcome_note = v_note, service_record_id = v_rec
      WHERE  id = si.id;

      -- Where unfinished work goes next (default: back to the person's Later list)
      IF v_outcome IN ('partial', 'not_done') AND nxt ->> 'kind' = 'session' THEN
        IF (nxt ->> 'session_id')::uuid = p_session THEN
          RAISE EXCEPTION 'Pick a different session for "%"', pw.title;
        END IF;
        INSERT INTO work_session_items (session_id, pending_work_id, position)
        VALUES ((nxt ->> 'session_id')::uuid, pw.id, 999);
      ELSIF v_outcome = 'partial' AND nxt ->> 'kind' = 'split' THEN
        INSERT INTO pending_work (vehicle_id, title, description, priority, status, identified_date, due_date,
                                  assigned_shop_id, assigned_to, reported_by)
        VALUES (v_vehicle,
                COALESCE(left(v_note, 80), pw.title || ' (rest)'),
                format('Rest of "%s", partly done %s (session "%s").', pw.title, to_char(v_date, 'MM/DD/YYYY'), s.title)
                  || COALESCE(E'\n' || v_note, ''),
                pw.priority, 'pending', v_date, pw.due_date, pw.assigned_shop_id, pw.assigned_to, pw.reported_by)
        RETURNING id INTO v_new;
        INSERT INTO pending_work_source_links (pending_work_id, source_id)
        SELECT v_new, source_id FROM pending_work_source_links WHERE pending_work_id = pw.id
        ON CONFLICT DO NOTHING;
        out_items := out_items || jsonb_build_object('id', v_new, 'vehicle_id', v_vehicle, 'kind', 'rest');
      END IF;
    END LOOP;

    -- ── Work done that wasn't planned ──
    FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(v -> 'extra_records', '[]')) LOOP
      CONTINUE WHEN NULLIF(btrim(r ->> 'title'), '') IS NULL;
      INSERT INTO service_records (vehicle_id, visit_id, service_date, category, title, total_cost, source)
      VALUES (v_vehicle, v_visit, v_date,
              COALESCE(NULLIF(r ->> 'category', ''), 'other')::service_category,
              btrim(r ->> 'title'), NULLIF(r ->> 'total_cost', '')::numeric, 'manual')
      RETURNING id INTO v_rec;
      out_records := out_records || (SELECT jsonb_build_object('id', id, 'vehicle_id', vehicle_id, 'title', title, 'category', category)
                                     FROM service_records WHERE id = v_rec);
    END LOOP;

    -- ── Found something new? One new source per vehicle ──
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v -> 'findings', '[]')) x
               WHERE NULLIF(btrim(x.value ->> 'title'), '') IS NOT NULL) THEN
      v_src := CASE WHEN v_visit IS NOT NULL
        THEN pending_source_id('service_visit', v_vehicle, v_visit,
               format('%s visit %s', COALESCE(sh.name, 'DIY'), to_char(v_date, 'MM/DD/YYYY')), v_date)
        ELSE pending_source_id('work_session', v_vehicle, p_session,
               format('Found during "%s" %s', s.title, to_char(v_date, 'MM/DD/YYYY')), v_date)
      END;

      FOR f IN SELECT value FROM jsonb_array_elements(v -> 'findings') LOOP
        CONTINUE WHEN NULLIF(btrim(f ->> 'title'), '') IS NULL;
        INSERT INTO pending_work (vehicle_id, title, description, priority, status, identified_date, due_date, assigned_to)
        VALUES (v_vehicle, btrim(f ->> 'title'), NULLIF(btrim(f ->> 'description'), ''),
                COALESCE(NULLIF(f ->> 'priority', ''), 'medium')::pending_priority, 'pending', v_date,
                NULLIF(f ->> 'due_date', '')::date, NULLIF(f ->> 'assigned_to', '')::uuid)
        RETURNING id INTO v_new;
        INSERT INTO pending_work_source_links (pending_work_id, source_id) VALUES (v_new, v_src);
        IF NULLIF(f ->> 'session_id', '') IS NOT NULL THEN
          IF (f ->> 'session_id')::uuid = p_session THEN
            RAISE EXCEPTION 'A new finding can''t go into the session being closed';
          END IF;
          INSERT INTO work_session_items (session_id, pending_work_id, position)
          VALUES ((f ->> 'session_id')::uuid, v_new, 999);
        END IF;
        out_items := out_items || jsonb_build_object('id', v_new, 'vehicle_id', v_vehicle, 'kind', 'finding');
      END LOOP;
    END IF;
  END LOOP;

  -- The status guard refuses if any item of the session still has no outcome
  UPDATE work_sessions SET status = 'closed' WHERE id = p_session;

  RETURN jsonb_build_object('visits', out_visits, 'records', out_records, 'new_items', out_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_work_session(uuid, jsonb) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- Test: supabase/scripts/20261017_test_session_close.sql (rolls itself back)
-- ═════════════════════════════════════════════════════════════════════════════
