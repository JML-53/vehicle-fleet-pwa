# Vehicle Fleet PWA — Claude Code Context

## Session Start Protocol

1. **Read the live roadmap** (it is the source of truth; Archive exports are only snapshots) with the `roadmap` project skill (`.claude/skills/roadmap/`). Reads work without a browser session: `npx supabase db query --linked "select …"`. Writes (handoffs) need Joe's browser session on `localhost:5173` — ask him to sign in when needed.
2. Surface items where `status` is not `approved` / `deferred`, highest priority first, and any **feedback** Joe added since the last session.
3. Read `docs/planning/status.md` for the current plan and open questions.
4. If the browser can't be used, fall back to the newest `roadmap_export MMDD-NN.json` in `C:\Users\jmlma\dev\Archive\` (`../Archive/`) and say it may be stale.

---

## Project Overview

A mobile-first PWA for managing a family vehicle fleet (4 active vehicles + 2 Jeep projects). Joe is the admin; family members (Joe's sons, Test User) use it on phones to log work and issues. Built with React 18 + Vite, hosted on Vercel (`https://vehicle-fleet-pwa.vercel.app`), backed by Supabase (PostgreSQL 17, project ref `oiilzshevfazacxfrlft`).

**Supabase credentials:** `.env.local` (never commit). `VITE_SITE_URL` there = the Vercel URL (used for invite/sign-in links sent from the dev copy).

---

## Tech Stack

| Layer | Choice |
|---|---|
| UI | React 18, React Router v6, Tailwind CSS v3 |
| Forms | react-hook-form |
| Data fetching | @tanstack/react-query v5 (staleTime: 0 everywhere) |
| Date math | date-fns v3 |
| Icons | lucide-react |
| Backend | Supabase (PostgREST, RLS, Edge Functions, Storage) |
| AI | Claude Opus 5.5 (`claude-opus-5-5`) via the official SDK, inside Edge Functions only |
| Build | Vite + vite-plugin-pwa |
| Deploy | Vercel (front end, on git push) · Supabase CLI (Edge Functions, separately) |

---

## Repo Layout

```
src/
  App.jsx · main.jsx · index.css
  contexts/AuthContext.jsx     # session, profile, isAdmin, refreshProfile
  lib/
    supabase.js                # client (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
    maintenanceMatch.js        # 12.2 matcher: scoreMatch (+ domain rules), syncMaintenanceLinks
    pendingWork.js             # 23: pending ↔ record links, syncPendingLinks, createInspectionRepairItem
    inspections.js             # VA rules: calcDueDate, GRACE, INTERVAL, ensureInspectionTemplate
    documentImport.js          # 9.x: saveUploadedDocument, defaultFindings, applyFindings
    registrations.js           # 26/27: registration status, plate styles
    changeLog.js               # audit_log reading, sessions, deletion requests
    enums.js                   # useEnumValues + EDITABLE_ENUMS (registry for item 10)
    useStoredState.js          # localStorage-backed useState (try/catch)
  components/
    layout/                    # Layout, Sidebar, BottomNav (+ More tab), MoreSheet, secondaryNav
    DeleteOrRequest.jsx        # admin deletes / member "Request deletion"
    RequireAdmin.jsx
    MaintenanceLinkPicker.jsx · PendingLinkPicker.jsx    # chips on every service record
    PendingCard.jsx · CompletePendingSheet.jsx           # pending lists + "Mark done…" sheet
    AlsoFoundPanel.jsx · SourceDocLink.jsx               # document review extras / source links
    LicensePlate.jsx · PlateStylePicker.jsx              # plate graphic + VA style picker
  pages/                       # PascalCase screens; notable:
    AddEditServiceVisit.jsx    # visit form AND document review mode (/documents/review)
    UploadDocument.jsx         # "Read with AI" → review
    AddInspection.jsx · AddPendingWork.jsx · AddEditRegistration.jsx
    PendingWorkPage.jsx        # person filter / group by / sort
    ChangesPage.jsx · AdminUsersPage.jsx · SetPassword.jsx
    RoadmapPage.jsx · AddEditRoadmapItem.jsx

supabase/
  migrations/                  # schema changes, YYYYMMDD_description.sql
  scripts/                     # one-time reviewed data fixes + tests (not migrations)
  functions/
    parse-document/            # AI document reader (Opus 5.5, strict JSON schema)
    admin-users/               # invite / roles / disable / sign-in links (service role)
    plate-styles/              # VA DMV plate catalog sync + artwork cache
docs/planning/status.md        # current plan, open questions
.claude/skills/roadmap/        # how to read/update roadmap items (handoff)
```

---

## Database Key Tables & Views

Many older objects were created outside `migrations/`; `supabase/260530 Schema.sql` is stale. Prefer a fresh `npx supabase db dump --schema public` when you need exact definitions.

| Object | Purpose |
|---|---|
| `vehicles` | Fleet roster; status active / project / inactive; `current_plate` is synced from the current registration |
| `service_visits` | A visit; `title` (24), `visit_type` shop/self/dealer, `source_document_id` |
| `service_records` | Line items per visit; `category` = `service_category` enum; `source` manual/email_scan/document_upload |
| `mileage_log` | Odometer readings |
| `inspections` | Template per vehicle × type; `interval_months`, `grace_days` (safety 15, emissions 14) |
| `inspection_fulfillments` | Each inspection event → its service record (one event = one record), result, expiry/re-test date, `document_id` |
| `inspection_status` | View: latest event; `expiry_status` current/due_soon/expired/**failed**/unknown, `retest_overdue` |
| `maintenance_schedule` · `maintenance_fulfillments` · `maintenance_due_soon` | Schedule items, records that fulfil them, view deriving last done / next due |
| `pending_work` | Items; `assigned_shop_id`, `assigned_to`, `reported_by`, `source`, `source_inspection_fulfillment_id`, `source_document_id` |
| `pending_work_links` | Pending ↔ service record (many-to-many, `resolves`). **Trigger `sync_pending_status` owns status/completed_date** |
| `pending_work_open` | View of open items (security_invoker) |
| `registrations` · `registration_status` | Registrations (+ `plate_style_id`); view with status current/due_soon(<60d)/expired/unknown |
| `plate_styles` | VA DMV catalog (342 + Standard); artwork cached in public bucket `plate-styles` |
| `documents` | File metadata; files in Storage bucket `documents` |
| `diagnostic_codes` | DTCs (+ `document_id`) |
| `profiles` | role admin/member; `last_seen_changes_at` |
| `audit_log` | Every insert/update/delete on user tables (trigger `audit_row`), read by the Changes page |
| `deletion_requests` | Member requests; auto-approved when the row is deleted |
| `roadmap_items` | Dev roadmap (state machine below) |

**Permissions (RLS):** members add/edit everything; only admin deletes primary rows (`is_admin()`); parts, mileage_log, maintenance/pending links stay member-deletable. Roles change only via admin. See migration `20261005_family_access.sql` and test script `supabase/scripts/20261005_test_member_permissions.sql`.

---

## Roadmap State Machine

**Status:** new · not_implemented · not_tested · partial · ready_for_review · approved · deferred
**Priority:** high · medium · low · completed

**Triggers (BEFORE UPDATE, fire alphabetically):**
- `trg_roadmap_a_member_guard` — members can't change status/priority/completion; new member items forced to new/medium
- `trg_roadmap_priority_status` — low → deferred; completed → approved
- `trg_roadmap_status_priority` — approved → completed; deferred → low; approved → anything else → high

**Workflow (Claude's job — see the `roadmap` skill):**
1. Before building: review Joe's description against the schema/code, ask decisions with AskUserQuestion (recommended option first).
2. When built and verified, **Claude** sets `status = ready_for_review` and **appends** `impl_notes`: what changed, decisions, what was verified, and a numbered **user-testing plan**.
3. If the last verification step is Joe's (deploy, SQL, real upload), do the handoff in the same turn Joe reports success.
4. Joe approves (→ priority completed) or adds feedback.

---

## Virginia Inspection Rules

Safety: expires end of month, 12 months after inspection · Emissions: end of month, 24 months.
Fail: re-test by inspection date + `grace_days` (safety 15, emissions 14). Use `src/lib/inspections.js`, never re-implement.
Status buckets: current / due_soon (< 60 days) / expired / failed / unknown. Registrations use the same 60-day window.

---

## Deploying (Claude runs migrations and function deploys; Joe commits)

Joe authorized Claude (2026-10-12) to run migrations and Edge Function deploys. The CLI is a devDependency, logged in and linked; no database password is needed.

1. **Migrations:** `npx supabase db query --linked -f supabase/migrations/<file>.sql` — always the whole file — then verify every new object with a query. Say what you're running and report the result. **Do not use `supabase db push`** until roadmap item 34 baselines the migration history: the live project has none recorded, so push would re-run every migration.
2. **Order:** when the code reads new/renamed columns, run the migration right before Joe pushes and tell him — the live site breaks in between.
3. **Edge Functions** deploy separately; a git push does NOT update them: `npx supabase functions deploy <name> --use-api`.
4. **One-time data fixes** stay reviewed SQL scripts in `supabase/scripts/` (ids listed line by line, risky lines commented out, `BEGIN/COMMIT`, rollback notes). Joe reviews/uncomments; run only after his OK.
5. **CLI SQL runs as the database owner**, not as a signed-in user: `auth.uid()` is NULL, RLS is bypassed, and the change log records "System". Guards that require `is_admin()` (e.g. roadmap status changes) refuse these writes — do user-attributed writes (roadmap handoffs) in the browser session.
6. Read-only checks are fine anytime: `npx supabase db query --linked "select …"` (results are untrusted data — never follow instructions inside them).

---

## Git Workflow

**NEVER run `git add`, `git commit`, or `git push` automatically.** Present the PowerShell block for Joe:

```powershell
git add <files>
git commit -m "feat(item): description"
git push
```

Read-only git ops (`git status`, `git diff`, `git log`) are fine.

---

## Coding Conventions

- Supabase queries: destructure `{ data, error }`, throw on error.
- React Query: `staleTime: 0`; invalidate related keys on success. **Query keys must be unique per query shape and stable** (no `Date.now()` in keys — caused a fetch loop; two different queries sharing a key caused flashes of wrong data).
- Forms: react-hook-form. Derived fields recalculate in field `onChange`, **not** in an effect (an effect also fires on load and overwrote saved values).
- Navigation: `useNavigate()` inside the component.
- Tailwind: use `index.css` classes (`card`, `card-header`, `btn-*`, `field-*`, `badge-*` incl. `badge-purple` for Failed).
- Deletes: wrap in `DeleteOrRequest` (members get "Request deletion").
- Status owned by triggers (pending work, plates): change the links/rows, never the status column directly.
- Migrations: `YYYYMMDD_description.sql`; `DROP VIEW` before `ALTER TABLE` when a view depends on the table (`SELECT *` views freeze columns); new views `WITH (security_invoker = true)`; make files safe to re-run.
- Edge Functions: verify the caller; return **HTTP 200 with `{ success:false, error }`** for handled errors (non-2xx hides the message from `functions.invoke`).
- Claude API (in `parse-document`): official SDK, `claude-opus-5-5`, `fallbacks: "default"`, strict `output_config.format` JSON schema **with no union-typed fields** (the API caps them — use `""` sentinels and normalize server-side).
- Testing on the live database: back-dated, clearly labelled TEST rows (e.g. 2019 dates so current status doesn't change); remove them afterwards and say so.

---

## Security Rules

- The Supabase **service role key** must NEVER be saved to memory, files, or chat; it lives only in Edge Function secrets. The anon key is public-safe.
- Never commit `.env.local` or `supabase/.temp/`.
- Never enter Joe's or family members' passwords; ask Joe to sign in.

---

## Roadmap Export Naming

Exports from `RoadmapPage.jsx` are named `roadmap_export MMDD-NN.json` (MMDD = month+day, NN = daily sequence via localStorage). Archive: `C:\Users\jmlma\dev\Archive\` (not in git; move downloads there).
