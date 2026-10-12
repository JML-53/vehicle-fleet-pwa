-- ═════════════════════════════════════════════════════════════════════════════
-- Roadmap guard: trust the no-user (service/owner) context
--
-- trg_roadmap_a_member_guard blocked every status/priority change unless the
-- caller is an admin. SQL run from the Supabase CLI (`db query --linked`), the
-- SQL Editor, or the service role has no signed-in user (auth.uid() IS NULL),
-- so those writes were refused too — which forced roadmap handoffs through
-- Joe's browser session.
--
-- Trust auth.uid() IS NULL, as profiles_role_guard already does. Safe: the only
-- callers without a user are the database owner / service role (already
-- unrestricted), and anonymous web requests never reach roadmap_items because
-- its RLS policies allow `authenticated` only.
--
-- Note: those writes show as "System" in the Changes page (no user to record).
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.roadmap_member_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Admins, and trusted no-user contexts (CLI / SQL Editor / service role)
  IF auth.uid() IS NULL OR is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status         := 'new';
    NEW.priority       := 'medium';
    NEW.date_completed := NULL;
  ELSIF NEW.status         IS DISTINCT FROM OLD.status
     OR NEW.priority       IS DISTINCT FROM OLD.priority
     OR NEW.date_completed IS DISTINCT FROM OLD.date_completed THEN
    RAISE EXCEPTION 'Only an admin can change roadmap status, priority or completion date';
  END IF;
  RETURN NEW;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
--   SELECT prosrc LIKE '%auth.uid() IS NULL OR is_admin()%' FROM pg_proc
--   WHERE proname = 'roadmap_member_guard';
-- ═════════════════════════════════════════════════════════════════════════════
