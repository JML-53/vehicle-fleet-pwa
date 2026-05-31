-- Item 21: Implement roadmap state machine
-- STATUS: complete → ready_for_review (rename + migrate)
-- PRIORITY: add 'completed'; triggers for approved→completed, deferred→low

-- ─── 1. Add new status values to the enum ───────────────────────────────────
ALTER TYPE roadmap_status ADD VALUE IF NOT EXISTS 'ready_for_review';
-- Note: 'complete' cannot be removed from a PG enum; it simply won't be used.

-- ─── 2. Migrate all existing 'complete' rows to 'ready_for_review' ──────────
UPDATE roadmap_items SET status = 'ready_for_review' WHERE status = 'complete';

-- ─── 3. Update priority CHECK constraint (add 'completed', remove wrong 'ready_for_review') ──
ALTER TABLE roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_priority_check;
ALTER TABLE roadmap_items
  ADD CONSTRAINT roadmap_items_priority_check
  CHECK (priority IN ('high', 'medium', 'low', 'completed'));

-- Clean up any rows that got 'ready_for_review' priority from the earlier wrong migration
UPDATE roadmap_items SET priority = 'medium' WHERE priority = 'ready_for_review';

-- ─── 4. Triggers ─────────────────────────────────────────────────────────────

-- Drop any old/incorrect triggers from earlier attempts
DROP TRIGGER IF EXISTS roadmap_complete_priority    ON roadmap_items;
DROP TRIGGER IF EXISTS roadmap_approved_priority    ON roadmap_items;
DROP TRIGGER IF EXISTS roadmap_complete_priority    ON roadmap_items;
DROP FUNCTION IF EXISTS trg_roadmap_complete_priority();
DROP FUNCTION IF EXISTS trg_roadmap_approved_priority();

CREATE OR REPLACE FUNCTION trg_roadmap_status_priority()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- approved → PRIORITY: completed
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.priority := 'completed';
  END IF;
  -- deferred → PRIORITY: low
  IF NEW.status = 'deferred' AND OLD.status IS DISTINCT FROM 'deferred' THEN
    NEW.priority := 'low';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER roadmap_status_priority
  BEFORE UPDATE ON roadmap_items
  FOR EACH ROW EXECUTE FUNCTION trg_roadmap_status_priority();

-- ─── 5. Back-fill existing approved and deferred rows ────────────────────────
UPDATE roadmap_items SET priority = 'completed' WHERE status = 'approved';
UPDATE roadmap_items SET priority = 'low'       WHERE status = 'deferred';

-- ─── 6. Mark item 21 ready for review ────────────────────────────────────────
UPDATE roadmap_items
  SET status     = 'ready_for_review',
      priority   = 'high',
      impl_notes = 'STATUS enum: ready_for_review added; all complete rows migrated. '
                || 'PRIORITY CHECK: completed added; ready_for_review removed (was incorrect). '
                || 'Triggers: approved→priority=completed, deferred→priority=low. '
                || 'Back-fill applied. RoadmapPage UI updated with correct badge styles.'
  WHERE item_number = '21';
