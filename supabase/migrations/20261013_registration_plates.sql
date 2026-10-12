-- ═════════════════════════════════════════════════════════════════════════════
-- Items 26 + 27 — registration status & license-plate styles
--
--   1. plate_styles: Virginia DMV specialty-plate catalog (synced on demand by
--      the plate-styles Edge Function) + a built-in "Standard" style.
--      image_path = artwork cached in the plate-styles bucket when first chosen.
--   2. registrations.plate_style_id
--   3. registration_status view: each vehicle's current registration with
--      status current / due_soon (< 60 days) / expired / unknown — the same
--      buckets as inspection_status
--   4. The current registration owns the plate: a trigger copies it to
--      vehicles.current_plate so older screens keep working and the two
--      can't disagree.
--   5. Public storage bucket for plate artwork
--
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. plate_styles ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plate_styles (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  state             text        NOT NULL DEFAULT 'VA',
  slug              text        NOT NULL,
  name              text        NOT NULL,
  category          text        NOT NULL,          -- Standard · Special Interest · College · Military · Other
  source_image_url  text,                          -- DMV artwork (absolute URL)
  image_path        text,                          -- cached copy in the plate-styles bucket
  synced_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state, slug)
);

CREATE INDEX IF NOT EXISTS idx_plate_styles_cat ON plate_styles (state, category, name);

ALTER TABLE plate_styles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plate styles read" ON plate_styles;
CREATE POLICY "plate styles read" ON plate_styles FOR SELECT TO authenticated USING (true);
-- Writes come only from the plate-styles Edge Function (service role)

INSERT INTO plate_styles (state, slug, name, category)
VALUES ('VA', 'standard', 'Standard Virginia plate', 'Standard')
ON CONFLICT (state, slug) DO NOTHING;


-- ── 2. registrations.plate_style_id ──────────────────────────────────────────

DROP VIEW IF EXISTS registration_status;   -- recreated below (CLAUDE.md: drop before ALTER)

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS plate_style_id uuid REFERENCES plate_styles(id) ON DELETE SET NULL;


-- ── 3. registration_status ───────────────────────────────────────────────────

CREATE VIEW registration_status WITH (security_invoker = true) AS
SELECT
  v.id                AS vehicle_id,
  v.name              AS vehicle_name,
  v.status            AS vehicle_status,
  v.vin,
  r.id                AS registration_id,
  r.plate,
  r.state,
  r.registration_date,
  r.expiry_date,
  r.document_id,
  ps.id               AS plate_style_id,
  ps.name             AS plate_style_name,
  ps.category         AS plate_style_category,
  ps.image_path       AS plate_style_image_path,
  CASE
    WHEN r.id IS NULL OR r.expiry_date IS NULL            THEN 'unknown'
    WHEN r.expiry_date < CURRENT_DATE                     THEN 'expired'
    WHEN r.expiry_date < CURRENT_DATE + interval '60 days' THEN 'due_soon'
    ELSE 'current'
  END                 AS registration_status,
  r.expiry_date - CURRENT_DATE AS days_until_expiry
FROM vehicles v
LEFT JOIN LATERAL (
  SELECT * FROM registrations
  WHERE  vehicle_id = v.id AND is_current
  ORDER  BY expiry_date DESC NULLS LAST, created_at DESC
  LIMIT  1
) r ON true
LEFT JOIN plate_styles ps ON ps.id = r.plate_style_id;

GRANT SELECT ON registration_status TO authenticated;


-- ── 4. Current registration owns the plate ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_vehicle_plate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  vid   uuid := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  plate text;
BEGIN
  SELECT r.plate INTO plate
  FROM   registrations r
  WHERE  r.vehicle_id = vid AND r.is_current
  ORDER  BY r.expiry_date DESC NULLS LAST, r.created_at DESC
  LIMIT  1;

  UPDATE vehicles SET current_plate = plate
  WHERE  id = vid AND current_plate IS DISTINCT FROM plate;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_vehicle_plate ON registrations;
CREATE TRIGGER trg_sync_vehicle_plate
  AFTER INSERT OR UPDATE OF plate, is_current, expiry_date, vehicle_id OR DELETE ON registrations
  FOR EACH ROW EXECUTE FUNCTION sync_vehicle_plate();


-- ── 5. Plate artwork bucket (public read; written by the Edge Function) ──────

INSERT INTO storage.buckets (id, name, public)
VALUES ('plate-styles', 'plate-styles', true)
ON CONFLICT (id) DO NOTHING;


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
--   SELECT vehicle_name, plate, expiry_date, registration_status, days_until_expiry
--   FROM registration_status ORDER BY vehicle_name;
-- ═════════════════════════════════════════════════════════════════════════════
