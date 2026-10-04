-- ─────────────────────────────────────────────────────────────────────────────
-- service_category: make 'interior' (and 'axles') explicit, and expose enum
-- values to the app so dropdowns stop hard-coding them.
--
-- Both values already exist in production (maintenance_schedule rows use them),
-- but service_category was created outside this migrations folder, so record
-- them here. IF NOT EXISTS makes this a no-op where they're already present.
--
-- enum_values() backs src/lib/enums.js (useEnumValues) and is the read half
-- of roadmap item 10 (admin enum editor).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE service_category ADD VALUE IF NOT EXISTS 'interior';
ALTER TYPE service_category ADD VALUE IF NOT EXISTS 'axles';

CREATE OR REPLACE FUNCTION public.enum_values(enum_name text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
  FROM pg_type t
  JOIN pg_enum e      ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid       = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typname = enum_name;
$$;

REVOKE ALL     ON FUNCTION public.enum_values(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enum_values(text) TO authenticated;

-- Verify:
-- SELECT enum_values('service_category');
