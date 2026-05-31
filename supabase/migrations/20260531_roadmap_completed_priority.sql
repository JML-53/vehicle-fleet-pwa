-- Item 21: Add 'completed' priority value; auto-set when status becomes 'approved'

-- 1. Widen the CHECK constraint to include 'completed'
ALTER TABLE roadmap_items
  DROP CONSTRAINT IF EXISTS roadmap_items_priority_check;

ALTER TABLE roadmap_items
  ADD CONSTRAINT roadmap_items_priority_check
  CHECK (priority IN ('high', 'medium', 'low', 'completed'));

-- 2. Trigger function: when status is set to 'approved', set priority = 'completed'
CREATE OR REPLACE FUNCTION trg_roadmap_approved_priority()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    NEW.priority := 'completed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER roadmap_approved_priority
  BEFORE UPDATE ON roadmap_items
  FOR EACH ROW EXECUTE FUNCTION trg_roadmap_approved_priority();

-- 3. Back-fill: set all existing approved items to priority = 'completed'
UPDATE roadmap_items
  SET priority = 'completed'
  WHERE status = 'approved';
