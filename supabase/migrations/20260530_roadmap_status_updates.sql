-- ─────────────────────────────────────────────────────────────────────────────
-- Roadmap status updates for work completed 2026-05-30
-- Run in Supabase SQL Editor after deploying code changes
-- ─────────────────────────────────────────────────────────────────────────────

-- Item 1.1 — Export button on Roadmap page
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-30',
  impl_notes     = 'Export button added to RoadmapPage.jsx header (beside Add Item). '
                || 'exportRoadmapJSON() uses existing allItems query data, creates a Blob, '
                || 'and triggers a browser download of roadmap_export.json. '
                || 'No additional SQL or API call needed — works from already-loaded data.'
WHERE item_number = '1.1' AND group_name = 'enhancement';

-- Item 12 — Due Date / Due Mileage (fix + fleet page)
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-30',
  impl_notes     = 'Root cause: maintenance_due_soon view was created before last_done_mileage '
                || 'column was added via ALTER TABLE. PostgreSQL freezes SELECT * expansion at '
                || 'view-creation time, so the new column was invisible. '
                || 'Fix: migration 20260530_fix_maintenance_view.sql recreates the view with '
                || 'CREATE OR REPLACE — PostgreSQL re-expands ms.* to include last_done_mileage. '
                || 'VehicleDetail nextDueMileage() already correct; now populates from view. '
                || 'MaintenanceSchedulePage: added Due Mileage column with same computation '
                || '(last_done_mileage + interval_miles) and matching urgency color coding.'
WHERE item_number = '12' AND group_name = 'enhancement';

-- Item 3.1 — Edit Maintenance Item from fleet Maintenance Schedule page
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-30',
  impl_notes     = 'Pencil icon added to each row in MaintenanceSchedulePage.jsx. '
                || 'Navigates to /vehicles/${vehicleId}/add-maintenance?edit=${row.id}, '
                || 'reusing the existing AddMaintenanceItem form which already supports edit mode. '
                || 'useNavigate added to the page component.'
WHERE item_number = '3.1' AND group_name = 'enhancement';

-- Item 3.2 — Edit Service History items + link to Service Visit
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-30',
  impl_notes     = 'New page AddEditServiceRecord.jsx created. Loads existing service_record '
                || 'with all parts, populates react-hook-form, supports edit + delete. '
                || 'Parts are individually upserted/deleted (no full replace). '
                || 'Pencil button added to each card in ServiceHistoryTab. '
                || 'Route: /vehicles/:id/service/:recordId/edit added to App.jsx.'
WHERE item_number = '3.2' AND group_name = 'enhancement';

-- Item 5.1 — Edit option for service_records in service_visit view
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-30',
  impl_notes     = 'Pencil icon added to each service record row inside the expanded ServiceVisitsTab. '
                || 'Uses same /vehicles/:id/service/:recordId/edit route as item 3.2. '
                || 'e.stopPropagation() prevents the visit-expand toggle from firing.'
WHERE item_number = '5.1' AND group_name = 'enhancement';

-- Item 5.2 — Group service visits by year
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-30',
  impl_notes     = 'ServiceVisitsTab refactored to group visits by year (descending). '
                || 'Year header rendered as card-header above each group. '
                || 'Year extracted from visit_date.slice(0, 4); "Unknown" used if date absent. '
                || 'VisitCard extracted as inner component to keep JSX clean.'
WHERE item_number = '5.2' AND group_name = 'enhancement';

-- Item 6 — Parts in UI + Service Visit form
UPDATE roadmap_items SET
  status         = 'partial',
  impl_notes     = 'AddEditServiceVisit.jsx built: comprehensive form for visit header + '
                || 'N service records each with N parts. Supports new visit and edit existing. '
                || 'Vehicle detail "Add Service" button replaced with "Log Visit" → /add-visit. '
                || 'Routes added: /vehicles/:id/add-visit and /vehicles/:id/visits/:visitId/edit. '
                || 'Self/Owner workflow: select "Self / DIY" visit type + appropriate shop. '
                || 'OUTSTANDING: AI document parsing (Supabase Edge Function parse-document) '
                || 'and Google Drive document back-fill still needed to complete this item.'
WHERE item_number = '6' AND group_name = 'enhancement';

-- Item 11.1 — Sort Maintenance table on vehicle/maintenance tab
UPDATE roadmap_items SET
  status         = 'complete',
  date_completed = '2026-05-30',
  impl_notes     = 'Sortable column headers added to MaintenanceTab in VehicleDetail.jsx. '
                || 'SortHeader component renders a clickable th with ▲/▼/⇅ indicator. '
                || 'Sortable columns: Item (text), Last Done (date), Due Date (date), Priority (order). '
                || 'Click same column again to reverse direction. '
                || 'Default sort: Priority ascending. '
                || 'Sort state is local (sortCol, sortDir); no query changes needed.'
WHERE item_number = '11.1' AND group_name = 'enhancement';
