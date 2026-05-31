-- Item 21: 'ready_for_review' priority + trigger on status = 'complete'

-- 1. Widen the CHECK constraint to include 'ready_for_review'
ALTER TABLE roadmap_items
  DROP CONSTRAINT IF EXISTS roadmap_items_priority_check;

ALTER TABLE roadmap_items
  ADD CONSTRAINT roadmap_items_priority_check
  CHECK (priority IN ('high', 'medium', 'low', 'ready_for_review'));

-- 2. Trigger function: when status becomes 'complete', set priority = 'ready_for_review'
CREATE OR REPLACE FUNCTION trg_roadmap_complete_priority()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'complete' AND (OLD.status IS DISTINCT FROM 'complete') THEN
    NEW.priority := 'ready_for_review';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER roadmap_complete_priority
  BEFORE UPDATE ON roadmap_items
  FOR EACH ROW EXECUTE FUNCTION trg_roadmap_complete_priority();

-- 3. Back-fill: all currently 'complete' items get priority = 'ready_for_review'
UPDATE roadmap_items
  SET priority = 'ready_for_review'
  WHERE status = 'complete';

-- 4. Update item 21 description + mark complete (ready for your review)
UPDATE roadmap_items
  SET status     = 'complete',
      priority   = 'ready_for_review',
      description = '- Add ''ready_for_review'' as a priority value (replaces earlier ''completed'' concept)' || chr(10) ||
                    '- Trigger auto-sets priority = ''ready_for_review'' when status changes to ''complete''' || chr(10) ||
                    '- Workflow: Claude sets complete → priority signals ready for review → you approve' || chr(10) ||
                    '- Badge: green check style in UI',
      impl_notes  = 'CHECK constraint updated. BEFORE UPDATE trigger created. Back-fill applied to existing complete items. RoadmapPage badge updated with green check style for ready_for_review priority.'
  WHERE item_number = '21';
