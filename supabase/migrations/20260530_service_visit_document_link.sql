-- ─────────────────────────────────────────────────────────────────────────────
-- Link service_visits back to the source document that was parsed to create them.
-- Enables the DocumentDetail page to show which visits were created from a doc.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE service_visits
  ADD COLUMN IF NOT EXISTS source_document_id uuid
    REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_visits_source_document
  ON service_visits(source_document_id)
  WHERE source_document_id IS NOT NULL;
