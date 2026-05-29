-- ─────────────────────────────────────────────────────────────────────────────
-- Roadmap: add priority column + deferred status
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add 'deferred' to the status enum
ALTER TYPE roadmap_status ADD VALUE IF NOT EXISTS 'deferred';

-- 2. Add priority column (high / medium / low)
ALTER TABLE roadmap_items
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('high', 'medium', 'low'));
