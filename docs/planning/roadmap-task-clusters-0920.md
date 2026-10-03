# Roadmap Task Clusters

Source: `../Archive/roadmap_export 0920-00.json` (41 items, exported 2026-09-20 23:12 UTC)
Scope: the 13 open items (status not `approved`/`deferred`)

Grouped by shared code paths and tables, not just parent/child item numbers — the goal is to avoid building the same linkage logic twice or building an AI-write path against a schema that's about to change.

---

## Cluster A — Document AI-parsing pipeline

**Items:** 9, 9.3, 9.4, 24, 28

All five extend the same `parse-document` Edge Function → `AddEditServiceVisit` / `AddInspection` prefill flow:

- **9** (immediate-parse + prefill) is the entry point everything else builds on
- **9.3** (auto-update inspection status from an uploaded report) and **28** (failed-inspection handling) both fire from the same "document creates/updates an `inspection_fulfillments` row" code path — 28 is really a status-logic refinement inside 9.3, not a separate feature
- **9.4** (extract diagnostics + pending work + maintenance updates from documents) is the same AI call, more output fields
- **24** (auto-generate a visit title from "the primary focus of the visit") is explicitly called out in its own description as something AI-generated — same extraction call, one more field

**Recommendation:** build 9 first; the rest are additive output fields on the same pipeline, not independent features.

---

## Cluster B — Pending Work ↔ Service Visit linking model

**Items:** 23 (foundation), 9.4 and 28 (dependents)

23 is where the *schema and UI* for linking `pending_work` to `service_visits` actually gets built (two-way links, "Create Service Visit" button, resolution toggle). But 9.4 ("add a Pending Work record" from a parsed document) and 28 ("create a pending work entry linked to the inspection") both assume that linking model already exists — they just need to write into it. Right now nothing to write into exists yet.

**Recommendation:** land 23 before implementing 9.4's and 28's pending-work-creation pieces, or the AI-write path will be built against a schema that's about to change underneath it.

---

## Cluster C — Maintenance auto-fulfillment matcher

**Items:** 12.2 (foundation), 9.4 (partial dependent)

12.2's own description says the service-record → `maintenance_schedule` linkage "would need to be built." 9.4 separately asks for the same thing from the document-parsing side ("indications that maintenance was performed → schedule should be updated"). These are the same matcher with two call sites (manual service-record entry vs. AI-extracted data).

**Recommendation:** build the matching/write logic once in 12.2, then have 9.4 call it — don't reimplement matching logic twice.

---

## Cluster D — Vehicle identity & registration display

**Items:** 26, 27

Both surface the same underlying fields (VIN, registration status, plate number) — 26 on the fleet-wide Dashboard, 27 on the individual Vehicle page. Worth a shared query/component (e.g., one "registration summary" hook) rather than two independent implementations, especially since 27's plate-graphic work is the more involved piece and 26 is basically "show the same data in a table column."

---

## Cluster E — Admin / user management

**Items:** 10, 25

25 ("User Account Manager Tool: admin-only creation, single admin account, control in left panel") is a fully-specified subset of 10 ("Admin interface for enums and users"). These aren't related tasks so much as the same task at two levels of detail. Treat 25 as 10's spec for the "users" half, and scope 10's "enums" half separately once the admin page's shape is known.

---

## Standalone (no coupling found)

- **B-2** — migrate service_record-tagged modifications into the `modifications` table. Worth noting it's the *same pattern* as the already-completed inspections refactor (item 22) and what 12.2/9.4 are doing for maintenance: eliminating a redundant "tracked twice" category inside `service_records`. Not a dependency, just a pattern that's now recurred three times.
- **2** — vehicle profile photo. Genuinely isolated, no shared tables or code paths with anything else open.

---

## Suggested build order

Sequencing by dependency rather than priority number:

1. **12.2** — maintenance auto-fulfillment matcher (foundation for Cluster C)
2. **23** — pending work ↔ service visit linking model (foundation for Cluster B)
3. **9** — document AI-parsing entry point (foundation for Cluster A)
4. **9.3, 9.4, 24, 28** — in any order, now that their dependencies exist
5. **26, 27** — vehicle identity/registration display, together
6. **10, 25** — admin/user management, together
7. **2, B-2** — standalone, pick up any time as fill-in work
