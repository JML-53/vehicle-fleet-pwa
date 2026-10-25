-- Item 29 Part C: the mechanic's copies of Storage files in Anthropic's Files API.
--
-- Conversations keep pointing at Storage paths (the app's own files); mechanic-chat
-- swaps each path for an Anthropic file id when it sends the conversation, so a
-- manual is uploaded once instead of re-sent as base64 every round. Files are
-- uploaded with a 90-day expiry and re-uploaded when they lapse or go missing.
-- File ids are workspace-scoped, so the row is per API key (key_source).
--
-- Only the mechanic-chat function (service role) reads and writes this table:
-- RLS on, no policies. Safe to re-run.

CREATE TABLE IF NOT EXISTS ai_files (
  storage_path text        NOT NULL,
  key_source   text        NOT NULL,            -- 'mechanic' | 'shared' (which API key uploaded it)
  file_id      text        NOT NULL,
  media_type   text        NOT NULL,
  size_bytes   bigint,
  tokens       integer,                         -- a document's size in tokens (count_tokens), once measured
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (storage_path, key_source)
);

ALTER TABLE ai_files ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ai_files IS
  'Item 29: Anthropic Files API copies of Storage files the mechanic reads. Service role only.';
