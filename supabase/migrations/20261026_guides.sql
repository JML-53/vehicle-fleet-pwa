-- ═════════════════════════════════════════════════════════════════════════════
-- Item 29 phase 1b — Guides: saved job procedures and check-off runs
--
--   1. guides — one procedure per vehicle and job, written by the mechanic and
--      reviewed before saving. body is `json` (keeps section order). Audited, so
--      the Changes page keeps every earlier version.
--   2. guide_runs — each time the job is done. At most one active run per guide,
--      so everyone working the job shares one checklist.
--   3. guide_run_steps — one row per checked step or step note, upserted per
--      step, so two phones checking different steps never overwrite each other.
--   4. pending_work.guide_id — the guide for a pending item (reused each time
--      the job comes round). pending_work_open lists its columns explicitly,
--      so it doesn't need recreating.
--   5. known_specs.guide_id — specs saved from a guide ("Save all specs")
--   6. ai_conversations.guide_run_id — "Ask about this step" chats
--   7. ai_messages: role 'system' + output_config, for per-message effort
--      changes (high effort while writing a guide without restarting the
--      prompt cache)
--
-- Runs and step ticks are not audited (every tick would flood the Changes page);
-- finishing a job logs a service visit through the normal flow.
--
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════


-- ── 1. Guides ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS guides (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id          uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  title               text        NOT NULL,
  job_type            text,
  body                json        NOT NULL,   -- sections: tools, parts, steps, mistakes, … (see mechanic-chat propose_guide)
  version             int4        NOT NULL DEFAULT 1,
  verified_at         timestamptz,            -- "worked as written"; cleared by a new version
  verified_by         uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  conversation_id     uuid        REFERENCES ai_conversations(id) ON DELETE SET NULL,
  source_tool_use_id  text,                   -- the mechanic card the latest version came from
  tool_use_ids        text[]      NOT NULL DEFAULT '{}',   -- every card saved into it (so an older version's card still reads "saved")
  created_by         uuid        REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Table already created by an earlier run of this file
ALTER TABLE guides ADD COLUMN IF NOT EXISTS tool_use_ids text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_guides_vehicle ON guides (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_guides_tool_use_ids ON guides USING gin (tool_use_ids);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guides_tool_use
  ON guides (source_tool_use_id) WHERE source_tool_use_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_guides_updated_at ON guides;
CREATE TRIGGER trg_guides_updated_at BEFORE UPDATE ON guides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── 2. Runs ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS guide_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id         uuid        NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  guide_version    int4        NOT NULL,
  pending_work_id  uuid        REFERENCES pending_work(id)  ON DELETE SET NULL,
  work_session_id  uuid        REFERENCES work_sessions(id) ON DELETE SET NULL,
  status           text        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'finished', 'abandoned')),
  outcome          text        CHECK (outcome IN ('as_written', 'with_changes')),
  started_by       uuid        REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_guide_runs_guide ON guide_runs (guide_id, started_at DESC);
-- One shared checklist per guide while a job is under way
CREATE UNIQUE INDEX IF NOT EXISTS uq_guide_runs_one_active
  ON guide_runs (guide_id) WHERE status = 'active';


-- ── 3. Step check-offs and notes ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS guide_run_steps (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid        NOT NULL REFERENCES guide_runs(id) ON DELETE CASCADE,
  step_index  int4        NOT NULL,           -- 0-based position in guides.body.steps
  done_at     timestamptz,                    -- NULL = not checked (may still carry a note)
  done_by     uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_index)
);

DROP TRIGGER IF EXISTS trg_guide_run_steps_updated_at ON guide_run_steps;
CREATE TRIGGER trg_guide_run_steps_updated_at BEFORE UPDATE ON guide_run_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── 4–6. Links ───────────────────────────────────────────────────────────────

ALTER TABLE pending_work     ADD COLUMN IF NOT EXISTS guide_id     uuid REFERENCES guides(id)     ON DELETE SET NULL;
ALTER TABLE known_specs      ADD COLUMN IF NOT EXISTS guide_id     uuid REFERENCES guides(id)     ON DELETE SET NULL;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS guide_run_id uuid REFERENCES guide_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pw_guide ON pending_work (guide_id) WHERE guide_id IS NOT NULL;


-- ── 7. Per-message effort in saved conversations ─────────────────────────────

ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS output_config json;   -- system rows: { "effort": "high" }
ALTER TABLE ai_messages DROP CONSTRAINT IF EXISTS ai_messages_role_check;
ALTER TABLE ai_messages ADD  CONSTRAINT ai_messages_role_check
  CHECK (role IN ('user', 'assistant', 'system'));


-- ── RLS + audit ──────────────────────────────────────────────────────────────
-- Same family rules as the rest of the app: members create and use guides and
-- runs; only an admin deletes a guide or a run. Step rows are member-deletable
-- (unchecking clears done_at; deleting a step note row is harmless).

ALTER TABLE guides          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_run_steps ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['guides', 'guide_runs', 'guide_run_steps'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "fam read"   ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "fam insert" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "fam update" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "fam delete" ON %I', t);
    EXECUTE format('CREATE POLICY "fam read"   ON %I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "fam insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "fam update" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "fam delete" ON %I FOR DELETE TO authenticated USING (%s)',
                   t, CASE WHEN t = 'guide_run_steps' THEN 'true' ELSE 'is_admin()' END);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_audit ON guides;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON guides
  FOR EACH ROW EXECUTE FUNCTION audit_row();
