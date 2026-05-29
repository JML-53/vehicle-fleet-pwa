-- ─────────────────────────────────────────────────────────────────────────────
-- Roadmap status back-fill for work completed 2026-05-28 / 2026-05-29
-- Run in Supabase SQL Editor after deploying the corresponding code changes
-- ─────────────────────────────────────────────────────────────────────────────

-- Enhancement 1 — Dev Tracker (this feature)
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-28',
  impl_notes     = 'roadmap_items table + status/group enums created via SQL migration. '
                || 'RoadmapPage.jsx added with grouped display, status filter chips, sort bar, '
                || 'expand-to-see-details, quick Approve button, and per-group Add buttons. '
                || 'AddEditRoadmapItem.jsx added with two-section form (Joe''s Review in amber, '
                || 'Implementation Notes in blue). Sidebar.jsx updated with Dev Roadmap link '
                || 'just above the user block. App.jsx wired with /roadmap, /roadmap/new, '
                || '/roadmap/:itemId/edit routes. All 19 TODO.txt items seeded as initial data.'
WHERE item_number = '1' AND group_name = 'enhancement';

-- Enhancement 13 — Dev Roadmap tweaks (the item whose description was pasted in this session)
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-29',
  impl_notes     = 'Seven changes made to RoadmapPage.jsx and AddEditRoadmapItem.jsx: '
                || '(1) Priority field (high/medium/low) added to form and displayed as colored dot on rows. '
                || '(2) Priority sort option added to sort bar. '
                || '(3) Item # auto-suggests next sequential number when group or parent changes. '
                || '(4) "+ Sub" button added on hover to every top-level row — opens Add form pre-filled with parent + group. '
                || '(5) Default sort changed to item_number (natural numeric sort). '
                || '(6) Filter chip order updated: All|New|Deferred|Not Impl.|Not Tested|Partial|Complete|Approved|Active. '
                || '(7) Active filter added (all except Approved + Deferred). '
                || 'Deferred status added to roadmap_status enum via migration 20260529_roadmap_priority_deferred.sql. '
                || 'Priority column (text, default medium) added to roadmap_items via same migration.'
WHERE item_number = '13' AND group_name = 'enhancement';

-- Enhancement 9 — Document upload on Documents page
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-28',
  impl_notes     = 'Upload button added to DocumentsPage.jsx header linking to /documents/upload. '
                || 'UploadDocument.jsx updated: added useQuery for vehicle list, vehicle picker '
                || 'dropdown shown when no vehicleId in route params, submit disabled until both '
                || 'vehicle and file are selected, success navigates to /documents instead of -1 '
                || 'when accessed from fleet route. New route /documents/upload added to App.jsx.'
WHERE item_number = '9' AND group_name = 'enhancement';

-- Enhancement 3 (partial) — Edit existing data
UPDATE roadmap_items SET
  status     = 'partial',
  impl_notes = 'Edit pencil buttons added to Notes, Specs, Diagnostics, Mods, Registrations, '
            || 'and Maintenance tabs in VehicleDetail. New pages created: AddEditNote, AddEditSpec, '
            || 'AddEditDiagnostic, AddEditMod, AddEditRegistration — all support add/edit/delete '
            || 'and navigate back to correct tab on save. Still outstanding: edit from fleet '
            || 'Maintenance Schedule page (3.1) and edit Service History items (3.2).'
WHERE item_number = '3' AND group_name = 'enhancement';

-- Enhancement 4 — Dashboard navigation
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-01',
  impl_notes     = 'Dashboard useRecentService query updated to select vehicle_id and vehicles(id,...). '
                || 'PendingItem links to /vehicles/${vehicle_id}?tab=pending. '
                || 'ServiceRow links to /vehicles/${vehicle_id}?tab=service.'
WHERE item_number = '4' AND group_name = 'enhancement';

-- Enhancement 4.1 — Recent service click
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-01',
  impl_notes     = 'Fixed as part of Enhancement 4 — same query and navigation fix.'
WHERE item_number = '4.1' AND group_name = 'enhancement';

-- Enhancement 5 — Service Visits tab
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-01',
  impl_notes     = 'ServiceVisitsTab component added to VehicleDetail.jsx. Fetches service_visits '
                || 'joined with shops, service_records, and parts. Each visit card is collapsible '
                || 'and shows all its service records with inline parts table.'
WHERE item_number = '5' AND group_name = 'enhancement';

-- Enhancement 6 — Parts in UI
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-01',
  impl_notes     = 'PartsTable component added. Parts fetched via nested Supabase select: '
                || 'service_records → parts(*). Displayed inline under each service record '
                || 'in both ServiceHistoryTab and ServiceVisitsTab.'
WHERE item_number = '6' AND group_name = 'enhancement';

-- Enhancement 8 — Link document to service items (filter chips)
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-01',
  impl_notes     = 'Filter chips (All, Oil, Tires, Brakes, Inspection, Registration, Electrical, Other) '
                || 'added to MaintenanceTab in VehicleDetail and to fleet-wide MaintenanceSchedulePage. '
                || 'matchesFilter / rowMatchesFilter keyword functions drive the filtering.'
WHERE item_number = '8' AND group_name = 'enhancement';

-- Bug B-1 — last_service_mileage column error
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-29',
  impl_notes     = 'AddMaintenanceItem.jsx corrected: last_service_mileage renamed to last_done_mileage, '
                || 'next_due_date removed from payload (computed by maintenance_due_soon view). '
                || 'Fix requires running: ALTER TABLE maintenance_schedule ADD COLUMN IF NOT EXISTS last_done_mileage integer; '
                || 'Confirmed working by Joe after running the SQL.'
WHERE item_number = 'B-1' AND group_name = 'bug';
