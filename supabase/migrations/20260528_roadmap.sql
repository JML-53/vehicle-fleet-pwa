-- ─────────────────────────────────────────────────────────────────────────────
-- Roadmap / Dev Tracker
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- Status enum  (matches the legend in TODO.txt, plus 'approved')
DO $$ BEGIN
  CREATE TYPE roadmap_status AS ENUM (
    'new',              -- [N]
    'not_tested',       -- [-]
    'partial',          -- [P]
    'complete',         -- [C]  (implemented but not yet approved by Joe)
    'approved',         -- Joe confirmed it works
    'not_implemented'   -- [X]
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Group enum
DO $$ BEGIN
  CREATE TYPE roadmap_group AS ENUM (
    'enhancement',
    'bug',
    'question'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Main table
CREATE TABLE IF NOT EXISTS roadmap_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id        uuid        REFERENCES roadmap_items(id) ON DELETE CASCADE,
  group_name       roadmap_group NOT NULL DEFAULT 'enhancement',
  status           roadmap_status NOT NULL DEFAULT 'new',
  item_number      text,            -- display label, e.g. "1", "5.1"
  title            text        NOT NULL,
  description      text,            -- full requirement text
  date_requested   date,
  date_completed   date,
  impl_notes       text,            -- what was built / changed (filled by developer/Claude)
  feedback         text,            -- Joe's approval notes or rejection reason
  sort_order       integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS roadmap_items_updated_at ON roadmap_items;
CREATE TRIGGER roadmap_items_updated_at
  BEFORE UPDATE ON roadmap_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE roadmap_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roadmap_auth_all" ON roadmap_items;
CREATE POLICY "roadmap_auth_all" ON roadmap_items
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED — pre-load all items from TODO.txt (2026-05-28)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO roadmap_items
  (group_name, status, item_number, title, description, date_requested, sort_order)
VALUES

-- ── Enhancements ──────────────────────────────────────────────────────────────
('enhancement','complete','1',
 'Dev Tracker (this feature)',
 'Add a new table and tab to track recommended changes for future development of this tool. Use tracking similar to what I''m doing in this document with the addition of date of request. It should enable me to approve any items that have been worked on and record the date of completion. It should allow me to sort and filter items. It should also include a two tier hierarchy of tasks and subtasks. Add a field that you can update to explain what specific changes were made to address the requirement. Add a field that allows me to provide feedback if I indicate that an item is incomplete or not implemented.',
 '2026-05-28', 10),

('enhancement','new','2',
 'Vehicle profile photo',
 'Add the ability to add a photo to the vehicle profile, display this photo on the vehicle page and on the vehicles list. Size photos appropriately for the U/I.',
 '2026-05-28', 20),

('enhancement','partial','3',
 'Edit existing data throughout interface',
 'Create more options to edit existing data throughout the interface. If I can see it, I should be able to edit it.',
 '2026-05-28', 30),

('enhancement','new','3.1',
 'Edit Maintenance Item from fleet Maintenance Schedule page',
 'Edit Maintenance Item on the Maintenance Schedule Tab from the home page.',
 '2026-05-28', 31),

('enhancement','new','3.2',
 'Edit Service History items + link to Service Visit',
 'Vehicle / Service History items should be editable. They should also include a link to the visit on the service_visit page.',
 '2026-05-28', 32),

('enhancement','complete','4',
 'Dashboard: clicking records navigates to correct record',
 'Clicking on a record on the Dashboard should take you to that record.',
 '2026-05-28', 40),

('enhancement','complete','4.1',
 'Recent service click navigates to correct vehicle + tab',
 'Clicking on recent service "CEL Diagnostic - P0016" takes you to the Vehicle list. It should open the vehicle''s Vehicle page, Service History Tab.',
 '2026-05-28', 41),

('enhancement','partial','5',
 'Expose Service Visits in vehicle UI',
 'Service Visits are not exposed anywhere in the UI. Add tab in Vehicle interface. Clicking a service visit should present a list of service_record items from that service_visit.',
 '2026-05-28', 50),

('enhancement','new','5.1',
 'Edit option for service_records in service_visit view',
 'There needs to be an edit option for each service_records entry in the service_visit page for a vehicle.',
 '2026-05-28', 51),

('enhancement','new','5.2',
 'Group service visits by year',
 'Add another layer of grouping to the service_visit page allowing visits to be grouped by year.',
 '2026-05-28', 52),

('enhancement','partial','6',
 'Expose Parts in UI, connected to service records',
 'Parts is not exposed anywhere in the UI. It should be connected to a service_records entry and there should be a supporting UI for it.',
 '2026-05-28', 60),

('enhancement','not_implemented','7',
 'Document: link to source records without creating new entries',
 'Documents: Link documents that were used as sources for original records in excel without creating new records.',
 '2026-05-28', 70),

('enhancement','complete','8',
 'Link document to service items',
 'Add Link document to any field that might have one: Service Item.',
 '2026-05-28', 80),

('enhancement','not_tested','9',
 'Document upload with AI parsing on Documents page',
 'Enable Document Upload with a control on Documents Page. Should trigger parsing of the documents using the same approach as was used when scanning documents in the Google Drive Vehicles\Documents for tracking\ Folder.',
 '2026-05-28', 90),

('enhancement','new','10',
 'Admin interface for enums and users',
 'Create Admin interface to add/edit enums, manage users.',
 '2026-05-28', 100),

('enhancement','not_implemented','11',
 'Column sorting throughout UI',
 'Enable Column Sorting throughout U/I where appropriate.',
 '2026-05-28', 110),

('enhancement','new','11.1',
 'Sort Maintenance table on vehicle/maintenance tab',
 'Allow Maintenance table to be sorted on vehicle/maintenance tab.',
 '2026-05-28', 111),

-- ── Bugs ──────────────────────────────────────────────────────────────────────
('bug','complete','B-1',
 'Edit Maintenance Item: last_service_mileage column error',
 'Edit Maintenance Item: Tried to update Tire Rotation record for the 15 Suburban. Set Confidence Level to Estimated. Set date to 11/30/25. Clicked Save Changes. Got an error message: "Could not find the ''last_service_mileage'' column of ''maintenance_schedule'' in the schema cache".',
 '2026-05-28', 10),

('bug','new','B-2',
 'Modifications from service_records not shown on Modifications tab',
 'Service_record identified Modifications are not shown on modification tab. Migrate these to the modifications table and remove the modification category from service_records.',
 '2026-05-28', 20),

-- ── Questions ─────────────────────────────────────────────────────────────────
('question','new','Q-1',
 'Does a service action auto-fulfill a scheduled maintenance item?',
 'Will the S/W recognize that a service action fulfills a scheduled maintenance item?',
 '2026-05-28', 10)

ON CONFLICT DO NOTHING;

-- Back-fill parent_id for sub-items using item_number prefix
-- 3.x → parent is item_number '3', same group
UPDATE roadmap_items child
SET parent_id = parent.id
FROM roadmap_items parent
WHERE child.group_name = parent.group_name
  AND child.item_number IN ('3.1','3.2')
  AND parent.item_number = '3';

UPDATE roadmap_items child
SET parent_id = parent.id
FROM roadmap_items parent
WHERE child.group_name = parent.group_name
  AND child.item_number IN ('5.1','5.2')
  AND parent.item_number = '5';

UPDATE roadmap_items child
SET parent_id = parent.id
FROM roadmap_items parent
WHERE child.group_name = parent.group_name
  AND child.item_number IN ('4.1')
  AND parent.item_number = '4';

UPDATE roadmap_items child
SET parent_id = parent.id
FROM roadmap_items parent
WHERE child.group_name = parent.group_name
  AND child.item_number IN ('11.1')
  AND parent.item_number = '11';

-- Implementation notes for completed items
UPDATE roadmap_items SET
  impl_notes = 'This feature (roadmap_items table + RoadmapPage) was built in response to this request.',
  date_completed = '2026-05-28'
WHERE item_number = '1' AND group_name = 'enhancement';

UPDATE roadmap_items SET
  impl_notes = 'Dashboard useRecentService query updated to select vehicle_id; PendingItem links to /vehicles/${id}?tab=pending; ServiceRow links to /vehicles/${id}?tab=service.',
  date_completed = '2026-05-01'
WHERE item_number = '4' AND group_name = 'enhancement';

UPDATE roadmap_items SET
  impl_notes = 'Same fix as item 4 — ServiceRow navigation target corrected to vehicle Service History tab.',
  date_completed = '2026-05-01'
WHERE item_number = '4.1' AND group_name = 'enhancement';

UPDATE roadmap_items SET
  impl_notes = 'ServiceVisitsTab added to VehicleDetail with collapsible visit cards. Each visit expands to show its service_record items and parts.',
  date_completed = '2026-05-01'
WHERE item_number = '5' AND group_name = 'enhancement';

UPDATE roadmap_items SET
  impl_notes = 'PartsTable component added to ServiceHistoryTab and ServiceVisitsTab. Parts are fetched via nested Supabase select: service_records → parts(*).',
  date_completed = '2026-05-01'
WHERE item_number = '6' AND group_name = 'enhancement';

UPDATE roadmap_items SET
  impl_notes = 'Upload button added to Documents page header linking to /documents/upload. UploadDocument.jsx updated to show vehicle picker when accessed without a vehicle context.',
  date_completed = '2026-05-28'
WHERE item_number = '9' AND group_name = 'enhancement';

UPDATE roadmap_items SET
  impl_notes = 'AddMaintenanceItem.jsx: renamed last_service_mileage → last_done_mileage (actual column after ALTER TABLE); removed next_due_date from payload (computed by view). Requires running: ALTER TABLE maintenance_schedule ADD COLUMN IF NOT EXISTS last_done_mileage integer;',
  date_completed = '2026-05-01'
WHERE item_number = 'B-1' AND group_name = 'bug';
