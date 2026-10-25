-- ═════════════════════════════════════════════════════════════════════════════
-- Item 29 phase 1b — voice noise test (plan build step 4)
--
-- One row per test recording: the phrase read aloud, the noise condition, the
-- audio (Storage: documents/voice-test/…), and each candidate transcriber's
-- result, written by the `voice` Edge Function. Recordings are kept so another
-- vendor can be tried on the same audio; delete them once a transcriber is
-- chosen (the test page has a button for that).
--
-- Admin only. Not audited (test data).
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS voice_tests (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase_no    int4,                       -- which test phrase (src/lib/voiceTest.js); NULL = custom
  expected     text          NOT NULL,     -- what was read aloud
  condition    text          NOT NULL CHECK (condition IN ('quiet', 'engine', 'tools', 'other')),
  audio_path   text          NOT NULL,
  media_type   text,
  duration_s   numeric(6,2),
  results      jsonb         NOT NULL DEFAULT '[]',   -- [{ key, model, prompt, text, ms, cost_usd, error }]
  created_by   uuid          REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_tests_created ON voice_tests (created_at DESC);

ALTER TABLE voice_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin all" ON voice_tests;
CREATE POLICY "admin all" ON voice_tests FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
