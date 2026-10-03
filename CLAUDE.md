# Vehicle Fleet PWA — Claude Code Context

## Session Start Protocol

1. Find the newest `roadmap_export MMDD-NN.json` in `../Archive/` (sort by filename; highest MMDD then NN wins).
2. Read it and surface all items where `priority = "high"` and `status` is not `"approved"` or `"deferred"`. These are the active work items.
3. Note today's date's export counter key (`roadmap_export_seq_MMDD` in localStorage, browser-side) for naming the next export.

---

## Project Overview

A mobile-first PWA for managing a personal vehicle fleet (4 active vehicles + 2 Jeep projects). Built with React 18 + Vite, hosted on Vercel, backed by Supabase (PostgreSQL 15).

**Live URL:** deployed on Vercel (check `vercel.json` for config)
**Supabase project:** credentials in `.env.local` (never commit)

---

## Tech Stack

| Layer | Choice |
|---|---|
| UI | React 18, React Router v6, Tailwind CSS v3 |
| Forms | react-hook-form |
| Data fetching | @tanstack/react-query v5 (staleTime: 0 everywhere) |
| Date math | date-fns v3 |
| Icons | lucide-react |
| Backend | Supabase (PostgREST, RLS, Edge Functions) |
| Build | Vite + vite-plugin-pwa |
| Deploy | Vercel |

---

## Repo Layout

```
src/
  App.jsx                  # Route definitions
  main.jsx                 # Entry point, QueryClientProvider, BrowserRouter
  index.css                # Tailwind directives + custom CSS classes
  lib/
    supabase.js            # Supabase client (reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
  contexts/
    AuthContext.jsx        # Session + profile state
  components/
    layout/Layout.jsx      # Shell: bottom nav, Outlet
  pages/
    Dashboard.jsx          # Home: inspection grid, fleet cards, pending work, recent service
    VehicleList.jsx
    VehicleDetail.jsx      # Tabs: overview, service, maintenance, inspections, pending, mods, docs, notes, specs, diagnostics, registration
    AddEditVehicle.jsx
    AddServiceRecord.jsx   # Quick-add service record
    AddEditServiceRecord.jsx
    AddEditServiceVisit.jsx
    AddPendingWork.jsx
    AddMaintenanceItem.jsx
    AddInspection.jsx      # Log or edit a safety/emissions inspection
    UploadDocument.jsx
    AddEditNote.jsx
    AddEditSpec.jsx
    AddEditDiagnostic.jsx
    AddEditMod.jsx
    AddEditRegistration.jsx
    PendingWorkPage.jsx    # Fleet-wide pending work
    MaintenanceSchedulePage.jsx
    DocumentsPage.jsx
    DocumentDetail.jsx
    RoadmapPage.jsx        # Dev roadmap with filter chips + JSON export
    AddEditRoadmapItem.jsx
    Login.jsx

supabase/
  migrations/              # All schema changes as timestamped .sql files
```

---

## Database Key Tables & Views

| Object | Purpose |
|---|---|
| `vehicles` | Fleet roster; status: active / project / inactive |
| `service_visits` | A shop visit; visit_type: shop / self / dealer |
| `service_records` | Line items per visit; category enum includes inspection |
| `mileage_log` | Odometer readings; source: service_visit / manual |
| `inspections` | Template: one row per vehicle × type (safety, emissions); holds interval_months |
| `inspection_fulfillments` | Join table: inspection_id → service_record_id; holds event-level data (date, expiry, result, report_number, shop_id) |
| `inspection_status` | View: LATERAL join for latest fulfillment per inspection; computes next_due_date (VA end-of-month rule) and expiry_status |
| `maintenance_schedule` | Manufacturer service items per vehicle |
| `maintenance_fulfillments` | Service records that satisfy a schedule item |
| `pending_work` / `pending_work_open` | Open work items (view filters status=open) |
| `shops` | Shop directory; is_self flag for DIY |
| `documents` | File metadata; storage via Supabase Storage |
| `roadmap_items` | Dev roadmap; status and priority drive the state machine (see below) |

---

## Roadmap State Machine

**Status values:** new · not_implemented · not_tested · partial · ready_for_review · approved · deferred  
**Priority values:** high · medium · low · completed

**DB triggers (BEFORE UPDATE, fire alphabetically):**
- `trg_roadmap_priority_status` — low → deferred; completed → approved
- `trg_roadmap_status_priority` — approved → completed; deferred → low; approved → anything_else → high

**Workflow:**
1. Claude works on item → sets `status = ready_for_review`
2. Joe reviews → sets `status = approved` (trigger auto-sets `priority = completed`)
3. Blocked/deferred → `status = deferred` (trigger auto-sets `priority = low`)

---

## Virginia Inspection Rules

Safety: expires end of month, 12 months from inspection date  
Emissions: expires end of month, 24 months from inspection date  
Expiry calc: `endOfMonth(addMonths(inspectionDate, interval_months))`  
Expiry status buckets: current / due_soon (< 60 days) / expired / unknown

---

## Git Workflow

**NEVER run `git add`, `git commit`, or `git push` automatically.**  
Always present the PowerShell block for Joe to review and run:

```powershell
git add <files>
git commit -m "feat: description"
git push
```

Read-only git ops (`git status`, `git diff`, `git log`) are fine to run directly.

---

## Coding Conventions

- Supabase queries: always destructure `{ data, error }`, throw on error
- React Query: `staleTime: 0` on all queries; invalidate related query keys on mutation success
- Forms: react-hook-form with `register` / `handleSubmit` / `watch` / `setValue`
- Navigation: `useNavigate()` must be declared inside the component (not at module level)
- Tailwind: use existing CSS classes from `index.css` (`card`, `card-header`, `btn-primary`, `btn-secondary`, `btn-danger`, `field-label`, `field-input`, `field-select`, `field-textarea`, `badge-*`)
- File naming: PascalCase pages, camelCase utilities
- Migrations: timestamped prefix `YYYYMMDD_description.sql`; always `DROP VIEW` before `ALTER TABLE` if a view depends on the column

---

## Security Rules

- The Supabase **service role key** must NEVER be saved to memory, files, or chat. The anon key (public-safe) is in `.env.local` as `VITE_SUPABASE_ANON_KEY`.
- Never commit `.env.local`.

---

## Roadmap Export Naming

Exports from `RoadmapPage.jsx` auto-generate filenames via localStorage:  
`roadmap_export MMDD-NN.json` where MMDD = month+day, NN = zero-padded daily sequence.  
Archives live in `../Archive/` (one level up from the project root).
