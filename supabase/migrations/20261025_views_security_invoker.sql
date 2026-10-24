-- ═════════════════════════════════════════════════════════════════════════════
-- Views respect RLS (security_invoker) — close the anon-key leak
--
-- vehicle_current_mileage and maintenance_due_soon predate the rule that views
-- are created WITH (security_invoker = true). Without it a view runs as its
-- owner (postgres), which bypasses RLS on the tables underneath — so the public
-- anon key, with no signed-in user, could read vehicle names, year/make/model,
-- plates, mileage and the whole maintenance schedule over the REST API.
--
-- security_invoker makes each view read its tables as the caller instead, so
-- the tables' own policies apply:
--   · anon          → no policy on vehicles / mileage_log / maintenance_* /
--                     service_records → the views return []
--   · authenticated → "fam read" (USING true) on all five tables → members see
--                     exactly what they saw before
--   · Edge Functions (mechanic-chat) → caller's JWT or service role, unchanged
--
-- maintenance_due_soon reads vehicle_current_mileage; each view checks its own
-- setting, so both need it (fixing only the outer one would still leak mileage
-- through the inner view).
--
-- ALTER VIEW … SET keeps the definitions as they are. Grants are unchanged:
-- SELECT stays granted to authenticated (and to anon, which now sees no rows —
-- the same as inspection_status, registration_status and pending_work_open).
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER VIEW public.vehicle_current_mileage SET (security_invoker = true);
ALTER VIEW public.maintenance_due_soon    SET (security_invoker = true);

GRANT SELECT ON public.vehicle_current_mileage TO authenticated;
GRANT SELECT ON public.maintenance_due_soon    TO authenticated;
