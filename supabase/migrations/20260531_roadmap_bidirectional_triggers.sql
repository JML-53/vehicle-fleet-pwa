-- Item 21: Bidirectional status ↔ priority triggers

-- ─── Status → Priority (updated with new case) ───────────────────────────────
CREATE OR REPLACE FUNCTION trg_roadmap_status_priority()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- → approved: priority = completed
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.priority := 'completed';
  -- → deferred: priority = low (takes precedence over approved→anything rule)
  ELSIF NEW.status = 'deferred' AND OLD.status IS DISTINCT FROM 'deferred' THEN
    NEW.priority := 'low';
  -- approved → anything else (not deferred): priority = high
  ELSIF OLD.status = 'approved'
    AND NEW.status NOT IN ('approved', 'deferred') THEN
    NEW.priority := 'high';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── Priority → Status (new) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_roadmap_priority_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- → low: status = deferred
  IF NEW.priority = 'low' AND OLD.priority IS DISTINCT FROM 'low' THEN
    NEW.status := 'deferred';
  -- → completed: status = approved
  ELSIF NEW.priority = 'completed' AND OLD.priority IS DISTINCT FROM 'completed' THEN
    NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$$;

-- Drop old trigger, recreate both (alphabetical order matters — priority fires before status)
DROP TRIGGER IF EXISTS roadmap_status_priority  ON roadmap_items;
DROP TRIGGER IF EXISTS roadmap_complete_priority ON roadmap_items;

CREATE TRIGGER roadmap_priority_to_status
  BEFORE UPDATE ON roadmap_items
  FOR EACH ROW EXECUTE FUNCTION trg_roadmap_priority_status();

CREATE TRIGGER roadmap_status_to_priority
  BEFORE UPDATE ON roadmap_items
  FOR EACH ROW EXECUTE FUNCTION trg_roadmap_status_priority();
