-- Roadmap status updates: session 2026-05-30 completions

-- Item 9: Document upload with AI parsing (already marked complete in export)
-- No change needed

-- Item 12: Display Due Date / Due Mileage (table width fix + interval sync)
UPDATE roadmap_items SET status = 'complete', notes = 'Table width fixed (removed max-width constraint). Interval data synced from spreadsheet (49 items). Due date and mileage now display correctly for all items with intervals set.' WHERE item_number = '12';

-- Item 12.3: Due date/mileage not populating for service-linked items
-- Diagnosed as data issue: AC System and Rear Brakes had NULL intervals (one-off repairs).
-- Interval sync migration resolved the underlying data gap.
UPDATE roadmap_items SET status = 'complete', notes = 'Investigated: root cause was NULL interval_months/interval_miles on AC System and Rear Brakes — these are one-off repairs, not recurring items. View logic is correct. Interval sync SQL populated missing intervals across all 4 active vehicles.' WHERE item_number = '12.3';

-- Item 17: Control Placement (sidebar sticky viewport anchoring)
UPDATE roadmap_items SET status = 'complete', notes = 'Sidebar changed from min-h-screen to h-screen sticky top-0 overflow-y-auto. Dev Roadmap link, user name, and Sign Out now anchor to bottom of viewport on all page lengths.' WHERE item_number = '17';

-- Item 18: Shop Field Combo box (inline Add New Shop)
UPDATE roadmap_items SET status = 'complete', notes = 'Inline Add New Shop form added directly in service visit form. Pre-fills from AI suggestion text. Saves to shops table and auto-selects the new shop in the dropdown.' WHERE item_number = '18';

-- Item 19: Delete Service Visit
UPDATE roadmap_items SET status = 'complete', notes = 'Two-step delete added to edit mode. Cascades: deletes parts, service_records, nulls mileage_log FK, then deletes the visit. Redirects to vehicle visits tab.' WHERE item_number = '19';
