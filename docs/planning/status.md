# Project status — 2026-10-13

Replaces `roadmap-task-clusters-0920.md` (kept for history). The live roadmap in the app is the source of truth; this file is the plan and the open questions around it.

## Done (approved) since moving to Claude Code — Oct 4–13

| Item | What |
|---|---|
| 12.2 | Service records auto-fulfil maintenance items (matcher + domain rules, reviewed backfill) |
| 25 + user half of 10 | Family accounts (invite / copy link), member permissions in RLS, deletion requests, change log + counter |
| 23 · 23.1 | Pending work ↔ service links (trigger-owned status), assignment, "Mark done…" sheet, by-person view + Dashboard My Work |
| 28 | Failed inspections: Failed (purple), grace-period re-test date, repair items, auto-close on pass |
| 9 · 9.3 · 9.4 · 9.5 · 24 | Read-first document upload (Opus 5.5), one review screen, "Also found" (inspection, DTCs, recommended work), one event = one record, source-document links, visit titles |
| 26 · 27 | Registration status on Dashboard + vehicle header chips; VA plate styles (DMV catalog) with plate graphic |
| 30 | Vehicle filter on Pending Work (approved 10/12) |
| 31 | Dashboard (approved 10/13): needs-attention strip, one Vehicles table with mileage, tabbed Work panel, ~60/40 on wide screens |
| 32 | Manage workflow (approved 10/13): shared sources (many:many), split / merge, "waiting on", due dates, per-line inspection repairs, work sessions with close-out (outcomes + new findings), Plan board `/plan` (people × weeks, drag, date button) |

## Rollout

- **Users:** Joe (admin) and Joseph (member) active; Paul invited, not yet activated; Gary and Jonathan may follow.
- **Teri** gets an account once the app is **fully stable** — so stability work (bugs, data consistency, mobile polish, the safe `npm audit fix`) should be weighed alongside new features like item 29.

## Open

| Item | Status | Next step |
|---|---|---|
| **29** AI Expert Mechanic + AI Development Advisor | ready_for_review · high | **Phase 1a built and live-tested 10/24** (chat, save cards, spec trust, AI usage page). Joe: test on the phone, create the mechanic's API key ($50 limit). **1b guides half built and live-tested 10/24** (all 7 recommended options; plan in `docs/planning/item-29-phase-1b.md`). Noise test done 10/25: listening = OpenAI gpt-transcribe + vocabulary + English (100% in noise); speaking = Google Chirp 3 HD (OpenAI TTS shuts down Jan 2027). Next: Joe sets up the Google key; build voice mode (plan doc "Voice mode build plan"), then Files API, Continue button |
| 10 Admin interface — enum half | partial · medium | Read path exists (`enum_values`, `EDITABLE_ENUMS`). Needs admin write RPC (`ALTER TYPE … ADD/RENAME VALUE`) and the "can't drop an enum value" decision (lookup table vs hidden list) |
| 2 Vehicle profile photo | new · low | Fill-in work |
| B-2 Modifications from service_records | new · low | Reuse 9.3's "one event, one record" approach |
| 20 Multiple feedback entries per item | deferred · low | Joe's design is sound; also give Claude's impl_notes dated entries. Pairs with 29's dev advisor |
| 9.1 Link old source documents | deferred · low | 9.5 covers new records; only pre-upload history remains |
| App-wide page widths | — | Follow-up from 31: wider list/table pages (Pending Work, Changes, Roadmap), forms stay narrow |
| Cleanup (from 32) | — | Later: drop the compatibility trigger + old `source*` columns once nothing reads them (do on item 34's local copy first) |
| 9.6 Link documents to visits, parts, specs, modifications, registrations | new · medium | From Joe's 9.2 feedback (10/12) |
| 33 Major dependency upgrades (React Router 7, Tailwind 4, Vite 8, vite-plugin-pwa 2) | new · medium | Remaining npm-audit work; React Router first (runtime). See Housekeeping |
| **34** Local Supabase dev environment in Docker (+ learning path) | new · medium | Not needed for 29's phases 1a/1b/2 (AI saves only to add-only knowledge tables; pending work goes through the normal form). Needed before any in-chat operational actions. Joe installs Docker Desktop + WSL2; then baseline (live has no migration history, and migration file versions collide — fix before any `db push`), seed data, local/live switching, local function testing, written workflow + tutorial |

## Item 29 — decisions (10/24)

Full write-up, including Joe's four use cases, in item 29's `impl_notes`.

**Use cases:** (1) saved DIY job guides with every step, mistakes, best practices and all specs; (2) decision aid, like the Rover tire choice; (3) troubleshooting → repair plan; (4) live help on a multi-day job (R2's Sniper EFI tune). In all cases, specs and procedures are saved to the vehicle.

**Decisions:**
1. Dev advisor **split**: admin Data health page (SQL checks + AI explanations/fix cards) + Claude Code `/fleet-audit` skill.
2. Phase **1a chat → 1b guides**. Pending work goes through **open-in-form** (pre-filled existing form; the user saves).
   - 2b. **Spec trust:** source + reference on every AI-saved spec; "unverified" badge until checked; safety-critical values from model memory never saved.
3. **Paid voice service**, planned with 1b; Android is the test platform; vendor chosen then.
4. **Opus 5.5**, effort per task, own workspace + key with a **$50/month** hard cap; admin AI-usage view.
5. Conversations **shared per vehicle**.
6. Parts: **good / better / OEM** tiers; RockAuto, local chain stores, vehicle specialists first.

**Phases:**
- **1a** mechanic chat: context incl. specs/notes/mods/manuals; web search; photos; Save spec / Save note cards; open-in-form; usage log; caller-verification helper (also fixes `parse-document`).
- **1b** Guides tab + check-off mode + paid voice.
- **2** Data health + `/fleet-audit`.

**Knowledge base = the mechanic's memory:** existing `known_specs`, `vehicle_notes` and `modifications`, plus a new `procedures` table (Guides). Gap: R2's Sniper EFI isn't in Modifications yet.

**Joe's prep for 1a:** create the mechanic's Anthropic workspace + API key with a $50 limit, and set it himself with `npx supabase secrets set ANTHROPIC_MECHANIC_API_KEY=…`.

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
