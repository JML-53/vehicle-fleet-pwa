-- ═════════════════════════════════════════════════════════════════════════════
-- Item 29 phase 1a — AI mechanic: conversations, messages, usage; spec trust
--
--   1. ai_conversations — shared per vehicle (decision 5); author or admin deletes
--   2. ai_messages — the exact API content blocks, append-only, written only by
--      the mechanic-chat Edge Function (service role). Stored as `json`, not
--      `jsonb`: jsonb re-sorts object keys, and Opus 5.5 / the prompt cache need
--      earlier turns sent back unchanged.
--   3. ai_usage — tokens + cost per API call, for the monthly cap and the admin
--      AI-usage page; kept when a conversation is deleted
--   4. known_specs — where a spec came from and whether someone checked it
--      (decision 2b); link back to the conversation that proposed it
--   5. vehicle_notes — link back to the conversation that proposed it
--
-- AI tables are not audited (they aren't fleet data); specs and notes the user
-- saves from a mechanic card are, through their existing trg_audit triggers.
--
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════


-- ── 1. Conversations ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_conversations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid        REFERENCES vehicles(id) ON DELETE CASCADE,   -- NULL = general question
  title            text        NOT NULL,
  entry            jsonb,                  -- where it was opened from: { kind, id, label }
  record_hash      text,                   -- hash of the vehicle record last sent to the model
  created_by       uuid        REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aic_vehicle_recent ON ai_conversations (vehicle_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_aic_recent         ON ai_conversations (last_message_at DESC);


-- ── 2. Messages ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid        NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  seq              int4        NOT NULL,
  role             text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content          json        NOT NULL,   -- API content blocks; images/PDFs as { source: { type: 'storage', path } }
  author           uuid        REFERENCES profiles(id) ON DELETE SET NULL,  -- who typed a user turn
  model            text,                   -- assistant: the model that answered
  stop_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, seq)
);


-- ── 3. Usage ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_usage (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid          REFERENCES ai_conversations(id) ON DELETE SET NULL,
  user_id             uuid          REFERENCES profiles(id) ON DELETE SET NULL,
  feature             text          NOT NULL DEFAULT 'mechanic',
  model               text          NOT NULL,
  key_source          text          CHECK (key_source IN ('mechanic', 'shared')),
  input_tokens        int4          NOT NULL DEFAULT 0,
  output_tokens       int4          NOT NULL DEFAULT 0,
  cache_write_tokens  int4          NOT NULL DEFAULT 0,
  cache_read_tokens   int4          NOT NULL DEFAULT 0,
  web_searches        int4          NOT NULL DEFAULT 0,
  web_fetches         int4          NOT NULL DEFAULT 0,
  cost_usd            numeric(10,4) NOT NULL DEFAULT 0,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aiu_created ON ai_usage (created_at DESC);


-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Conversations: everyone reads (shared per vehicle), anyone starts one as
-- themselves, author or admin deletes. Messages and usage have no client write
-- policies — only the Edge Function (service role) writes them.

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fam read"     ON ai_conversations;
DROP POLICY IF EXISTS "own insert"   ON ai_conversations;
DROP POLICY IF EXISTS "fam update"   ON ai_conversations;
DROP POLICY IF EXISTS "own delete"   ON ai_conversations;
CREATE POLICY "fam read"   ON ai_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "own insert" ON ai_conversations FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "fam update" ON ai_conversations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "own delete" ON ai_conversations FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "fam read"   ON ai_messages;
DROP POLICY IF EXISTS "own delete" ON ai_messages;
CREATE POLICY "fam read"   ON ai_messages FOR SELECT TO authenticated USING (true);
-- Belt and braces for the cascade when a conversation is deleted
CREATE POLICY "own delete" ON ai_messages FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM ai_conversations c
                 WHERE c.id = conversation_id AND (c.created_by = auth.uid() OR is_admin())));

DROP POLICY IF EXISTS "own or admin read" ON ai_usage;
CREATE POLICY "own or admin read" ON ai_usage FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());


-- ── 4. Spec trust (decision 2b) ──────────────────────────────────────────────
-- source NULL = entered by the family before the mechanic existed (no badge).
-- A spec with a source other than 'family' and no verification shows "unverified".

ALTER TABLE known_specs
  ADD COLUMN IF NOT EXISTS source             text,
  ADD COLUMN IF NOT EXISTS source_ref         text,     -- URL, or "manual p.41"
  ADD COLUMN IF NOT EXISTS safety_critical    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification       text,
  ADD COLUMN IF NOT EXISTS verified_at        timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id    uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_tool_use_id text;     -- the mechanic card it was saved from

ALTER TABLE known_specs DROP CONSTRAINT IF EXISTS known_specs_source_check;
ALTER TABLE known_specs ADD  CONSTRAINT known_specs_source_check
  CHECK (source IS NULL OR source IN ('family', 'manual', 'web', 'ai_knowledge'));
ALTER TABLE known_specs DROP CONSTRAINT IF EXISTS known_specs_verification_check;
ALTER TABLE known_specs ADD  CONSTRAINT known_specs_verification_check
  CHECK (verification IS NULL OR verification IN ('checked_manual', 'worked_as_written'));

-- One saved row per mechanic card (a second tap can't save it twice)
CREATE UNIQUE INDEX IF NOT EXISTS uq_known_specs_tool_use
  ON known_specs (source_tool_use_id) WHERE source_tool_use_id IS NOT NULL;


-- ── 5. Notes from the mechanic ───────────────────────────────────────────────

ALTER TABLE vehicle_notes
  ADD COLUMN IF NOT EXISTS conversation_id    uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_tool_use_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_notes_tool_use
  ON vehicle_notes (source_tool_use_id) WHERE source_tool_use_id IS NOT NULL;
