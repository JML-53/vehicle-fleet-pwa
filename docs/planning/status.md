# Project status — 2026-10-13

Replaces `roadmap-task-clusters-0920.md` (kept for history). The live roadmap in the app is the source of truth; this file is the plan and the open questions around it.

## Done (approved) since moving to Claude Code — Oct 4–12

| Item | What |
|---|---|
| 12.2 | Service records auto-fulfil maintenance items (matcher + domain rules, reviewed backfill) |
| 25 + user half of 10 | Family accounts (invite / copy link), member permissions in RLS, deletion requests, change log + counter |
| 23 · 23.1 | Pending work ↔ service links (trigger-owned status), assignment, "Mark done…" sheet, by-person view + Dashboard My Work |
| 28 | Failed inspections: Failed (purple), grace-period re-test date, repair items, auto-close on pass |
| 9 · 9.3 · 9.4 · 9.5 · 24 | Read-first document upload (Opus 5.5), one review screen, "Also found" (inspection, DTCs, recommended work), one event = one record, source-document links, visit titles |
| 26 · 27 | Registration status on Dashboard + vehicle header chips; VA plate styles (DMV catalog) with plate graphic |
| 30 | Vehicle filter on Pending Work (approved 10/12) |
| 32 | Manage workflow (approved 10/13): shared sources (many:many), split / merge, "waiting on", due dates, per-line inspection repairs, work sessions with close-out (outcomes + new findings), Plan board `/plan` (people × weeks, drag, date button) |

## Rollout

- **Users:** Joe (admin) and Joseph (member) active; Paul invited, not yet activated; Gary and Jonathan may follow.
- **Teri** gets an account once the app is **fully stable** — so stability work (bugs, data consistency, mobile polish, the safe `npm audit fix`) should be weighed alongside new features like item 29.

## Open

| Item | Status | Next step |
|---|---|---|
| **29** AI Expert Mechanic + AI Development Advisor | new · high | **Joe to answer the questions below**, then plan phase 1 |
| 10 Admin interface — enum half | partial · medium | Read path exists (`enum_values`, `EDITABLE_ENUMS`). Needs admin write RPC (`ALTER TYPE … ADD/RENAME VALUE`) and the "can't drop an enum value" decision (lookup table vs hidden list) |
| 2 Vehicle profile photo | new · low | Fill-in work |
| B-2 Modifications from service_records | new · low | Reuse 9.3's "one event, one record" approach |
| 20 Multiple feedback entries per item | deferred · low | Joe's design is sound; also give Claude's impl_notes dated entries. Pairs with 29's dev advisor |
| 9.1 Link old source documents | deferred · low | 9.5 covers new records; only pre-upload history remains |
| **31** Dashboard Refinement | **ready_for_review** · high | Built 10/13 to the approved mockup: attention strip, one Vehicles table (+ mileage, projects collapsed), tabbed Work panel (My work · Next up · High priority · Recent), ~60/40 on wide screens. Joe to test (7 steps in impl_notes) |
| App-wide page widths | — | Follow-up from 31: wider list/table pages (Pending Work, Changes, Roadmap), forms stay narrow |
| Cleanup (from 32) | — | Later: drop the compatibility trigger + old `source*` columns once nothing reads them (do on item 34's local copy first) |
| 9.6 Link documents to visits, parts, specs, modifications, registrations | new · medium | From Joe's 9.2 feedback (10/12) |
| 33 Major dependency upgrades (React Router 7, Tailwind 4, Vite 8, vite-plugin-pwa 2) | new · medium | Remaining npm-audit work; React Router first (runtime). See Housekeeping |
| **34** Local Supabase dev environment in Docker (+ learning path) | new · medium | **Do before 29.** Joe installs Docker Desktop + WSL2; then baseline (live has no migration history, and migration file versions collide — fix before any `db push`), seed data, local/live switching, local function testing, written workflow + tutorial |

## Item 29 — open questions for Joe

Proposed phases: (1) mechanic chat with vehicle context + web search → (2) voice → (3) confirmed actions (pending items, parts lists) → (4) dev advisor read-only data audits + proposals.

1. **Who** uses each persona — mechanic for everyone, dev advisor admin-only?
2. **Monthly AI budget** you're comfortable with (drives model, effort, how much history is read).
3. **Voice**: essential for v1 or fast-follow? (Browser speech recognition + read-aloud is free and works hands-free in Chrome/Android; partial on iPhone.)
4. **Save conversations** per vehicle so the mechanic remembers prior diagnoses?
5. **Parts sources** you prefer (RockAuto, NTB, local stores…) and price vs brand priority.
6. **Mechanic actions**: advise only, or also create pending items / parts lists after you confirm?

Design guardrails already agreed in principle: Claude calls only from Edge Functions (key never in the browser); the dev advisor reads through narrow RPCs (no arbitrary SQL) and every fix needs approval through normal app paths (audit log + permissions apply); safety-critical specs (brakes, jacking, fuel, airbags, torque values) are cited and flagged when uncertain.

## Housekeeping backlog

- **Rover data fix (pending Joe's review):** `supabase/scripts/20261012_rover_link_inspection_repairs.sql` links the split tires/brake items to the 09/24 failed safety inspection so the passing re-test closes them (line 3 duplicate: Joe picks 3a, 3b or neither).

- Schema snapshot (Joe chose the exact dump): folded into item 34 — once Docker is installed, `npx supabase db pull` writes the baseline migration and `npx supabase db dump --schema public -f supabase/schema.sql` the reference dump. Until then, `npx supabase db query --linked` against the catalog works without Docker.
- **Never run `npx supabase db push` before item 34's baseline:** the live project has no migration history, so push would try to re-run all 23 migrations.
- ~~Roadmap guard trusts the CLI/service context~~ — done 2026-10-12 (`20261014_roadmap_guard_service_context.sql`); handoffs now work from the CLI.
- npm scripts for function deploy / schema dump.
- `npm audit`: Joe ran the safe `npm audit fix` on 2026-10-12 (16 packages changed; build passes). **12 findings remain (6 high, 6 moderate) → roadmap item 33:**
  - **React Router 6 → 7 — runtime code that reaches phones; do first.** Low practical risk here (internal links only, no SSR), but it's the only remaining fix in shipped code.
  - Tailwind 3 → 4, Vite 5 → 8, vite-plugin-pwa → 2 — dev/build tooling only; Tailwind 4 changes the config format.
- Optional: longer Supabase Auth session for the dev copy (Claude often finds it signed out).
