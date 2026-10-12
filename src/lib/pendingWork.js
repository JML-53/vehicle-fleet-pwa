/**
 * pendingWork — shared logic for pending work items (roadmap item 23).
 *
 * A pending item is linked to the service record(s) that addressed it via
 * pending_work_links (migration 20261006_pending_work_links.sql). A link with
 * resolves = true closes the item; the sync_pending_status() trigger keeps
 * status and completed_date in step, so the app only manages links.
 *
 * Items 9.4 and 28 should create links through syncPendingLinks / linkRecord
 * rather than writing pending_work.status directly.
 *
 * Item 32: where work was reported lives in pending_work_sources (one object
 * shared by every item it produced, many:many via pending_work_source_links);
 * "waiting on" in pending_work_deps; split / merge are single-transaction RPCs
 * (migrations 20261015_workflow_sources_sessions.sql, 20261016_workflow_split_merge.sql).
 */
import { useQuery } from '@tanstack/react-query'
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { rankScheduleItems, SUGGEST_THRESHOLD } from '@/lib/maintenanceMatch'

export const PRIORITY_META = {
  high:        { label: 'High',        badge: 'badge-red',   icon: '🔴' },
  medium:      { label: 'Medium',      badge: 'badge-amber', icon: '🟡' },
  low:         { label: 'Low',         badge: 'badge-slate', icon: '⚪' },
  watch:       { label: 'Watch',       badge: 'badge-blue',  icon: '👁' },
  conditional: { label: 'Conditional', badge: 'badge-slate', icon: '⚙️' },
}

export const STATUS_META = {
  pending:     { label: 'Pending',     badge: 'badge-amber' },
  in_progress: { label: 'In progress', badge: 'badge-blue' },
  deferred:    { label: 'Deferred',    badge: 'badge-slate' },
  completed:   { label: 'Completed',   badge: 'badge-green' },
  cancelled:   { label: 'Cancelled',   badge: 'badge-slate' },
}

export const CLOSED = ['completed', 'cancelled']

// Links with the record (and its visit/shop) embedded
const LINKS_EMBED = `pending_work_links(
  id, resolves,
  service_records(id, title, service_date, visit_id,
    service_visits(id, visit_date, shops(name)))
)`

// Item 32: sources, what this waits on, and what waits on it
const SOURCES_EMBED = `source_links:pending_work_source_links(id,
  source:pending_work_sources(id, kind, label, inspection_fulfillment_id, document_id, service_visit_id, reported_date))`
const DEPS_EMBED = `waits_on:pending_work_deps!pending_work_deps_pending_work_id_fkey(id, kind,
    blocker:pending_work!pending_work_deps_blocked_by_id_fkey(id, title, status, vehicle_id)),
  blocks:pending_work_deps!pending_work_deps_blocked_by_id_fkey(id, kind,
    waiter:pending_work!pending_work_deps_pending_work_id_fkey(id, title, status, vehicle_id))`

export const PENDING_SELECT = `*, ${LINKS_EMBED}, ${SOURCES_EMBED}, ${DEPS_EMBED},
  assigned_shop:shops!pending_work_assigned_shop_id_fkey(id, name, is_self),
  source_inspection:inspection_fulfillments!pending_work_source_inspection_fulfillment_id_fkey(id, inspection_date, result, inspections(inspection_type))`

// ── Queries ──────────────────────────────────────────────────────────────────

export function useVehiclePendingWork(vehicleId, { includeClosed = false } = {}) {
  return useQuery({
    queryKey: ['pending_work', vehicleId, { includeClosed }],
    queryFn: async () => {
      let q = supabase.from('pending_work').select(PENDING_SELECT).eq('vehicle_id', vehicleId)
      if (!includeClosed) q = q.not('status', 'in', `(${CLOSED.join(',')})`)
      const { data, error } = await q.order('status').order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!vehicleId,
    staleTime: 0,
  })
}

export function useFleetPendingWork({ includeClosed = false } = {}) {
  return useQuery({
    queryKey: ['pending_work_fleet', { includeClosed }],
    queryFn: async () => {
      let q = supabase.from('pending_work').select(`${PENDING_SELECT}, vehicles(name)`)
      if (!includeClosed) q = q.not('status', 'in', `(${CLOSED.join(',')})`)
      const { data, error } = await q.order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    staleTime: 0,
  })
}

/** Open items assigned to one person (Dashboard "My work" card, item 23.1). */
export function useMyOpenWork(userId) {
  return useQuery({
    queryKey: ['pending_work_fleet', 'mine', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_work')
        .select('id, vehicle_id, title, priority, status, vehicles(name)')
        .eq('assigned_to', userId)
        .not('status', 'in', `(${CLOSED.join(',')})`)
      if (error) throw error
      return data.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    },
    enabled: !!userId,
    staleTime: 0,
  })
}

const PRIORITY_ORDER = ['high', 'medium', 'low', 'watch', 'conditional']
export const priorityRank = p => { const i = PRIORITY_ORDER.indexOf(p); return i < 0 ? 99 : i }

export function usePendingItem(id) {
  return useQuery({
    queryKey: ['pending_work_item', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('pending_work').select(PENDING_SELECT).eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: !!id,
    staleTime: 0,
  })
}

/** Recent service records for a vehicle (for "Link existing record"). */
export function useRecentRecords(vehicleId, limit = 40) {
  return useQuery({
    queryKey: ['recent_records', vehicleId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_records')
        .select('id, title, service_date, category, visit_id, service_visits(shops(name))')
        .eq('vehicle_id', vehicleId)
        .order('service_date', { ascending: false, nullsFirst: false })
        .limit(limit)
      if (error) throw error
      return data
    },
    enabled: !!vehicleId,
    staleTime: 0,
  })
}

/** Every source recorded for a vehicle (for "Add a source" on the item form). */
export function useVehicleSources(vehicleId) {
  return useQuery({
    queryKey: ['pending_work_sources', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_work_sources')
        .select('id, kind, label, reported_date')
        .eq('vehicle_id', vehicleId)
        .order('reported_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data
    },
    enabled: !!vehicleId,
    staleTime: 0,
  })
}

/** Items that came from one inspection, via its source (VehicleDetail "Repairs: …"). */
export function useInspectionRepairItems(fulfillmentId) {
  return useQuery({
    queryKey: ['pending_work', 'from_inspection', fulfillmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_work_sources')
        .select('pending_work_source_links(pending_work(id, title, status))')
        .eq('inspection_fulfillment_id', fulfillmentId)
        .maybeSingle()
      if (error) throw error
      return (data?.pending_work_source_links || []).map(l => l.pending_work).filter(Boolean)
    },
    enabled: !!fulfillmentId,
    staleTime: 0,
  })
}

export function useShopsList() {
  return useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const { data, error } = await supabase.from('shops').select('id, name, is_self').order('name')
      if (error) throw error
      return data
    },
  })
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Make a service record's pending links match `links` exactly.
 * links: [{ pending_work_id, resolves }]
 */
export async function syncPendingLinks(serviceRecordId, links = []) {
  const { data: current, error } = await supabase
    .from('pending_work_links')
    .select('id, pending_work_id, resolves')
    .eq('service_record_id', serviceRecordId)
  if (error) throw error

  const wanted = new Map(links.map(l => [l.pending_work_id, !!l.resolves]))
  const have   = new Map(current.map(l => [l.pending_work_id, l]))

  const toDelete = current.filter(l => !wanted.has(l.pending_work_id)).map(l => l.id)
  if (toDelete.length) {
    const { error } = await supabase.from('pending_work_links').delete().in('id', toDelete)
    if (error) throw error
  }
  for (const [pid, resolves] of wanted) {
    const existing = have.get(pid)
    if (!existing) {
      const { error } = await supabase.from('pending_work_links')
        .insert({ pending_work_id: pid, service_record_id: serviceRecordId, resolves })
      if (error) throw error
    } else if (existing.resolves !== resolves) {
      const { error } = await supabase.from('pending_work_links')
        .update({ resolves }).eq('id', existing.id)
      if (error) throw error
    }
  }
}

export async function linkRecord(pendingWorkId, serviceRecordId, resolves) {
  const { error } = await supabase.from('pending_work_links')
    .upsert({ pending_work_id: pendingWorkId, service_record_id: serviceRecordId, resolves },
            { onConflict: 'pending_work_id,service_record_id' })
  if (error) throw error
}

export async function setLinkResolves(linkId, resolves) {
  const { error } = await supabase.from('pending_work_links').update({ resolves }).eq('id', linkId)
  if (error) throw error
}

export async function unlink(linkId) {
  const { error } = await supabase.from('pending_work_links').delete().eq('id', linkId)
  if (error) throw error
}

/** "- Parking brake\n• Front tires" → ['Parking brake', 'Front tires'] */
export function repairLines(text) {
  return (text || '')
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

/**
 * "Fix it" items for a failed inspection (items 28, 32). One item per repair
 * line (a single line or none → one "Repairs to pass … inspection" item), all
 * from the same inspection source and due by the re-test deadline. A later
 * passing re-test closes every one of them (trg_close_repairs_on_pass).
 * Reused by AI parsing of inspection reports (item 9.3). Returns the new ids.
 */
export async function createInspectionRepairItems({ vehicleId, fulfillmentId, inspectionType, inspectionDate, repairs, shopId, documentId }) {
  const label = inspectionType === 'safety' ? 'safety' : 'emissions'

  // Re-test deadline, the same rule as the inspection_status view
  const { data: f, error: fErr } = await supabase
    .from('inspection_fulfillments')
    .select('inspection_date, expiry_date, inspections(grace_days)')
    .eq('id', fulfillmentId).single()
  if (fErr) throw fErr
  const due = f.expiry_date
    || format(addDays(parseISO(f.inspection_date), f.inspections?.grace_days ?? 14), 'yyyy-MM-dd')

  const lines  = repairLines(repairs)
  const pieces = lines.length >= 2
    ? lines.map(l => (l.length > 80 ? { title: `${l.slice(0, 77)}…`, description: l } : { title: l, description: null }))
    : [{ title: `Repairs to pass ${label} inspection`, description: repairs?.trim() || null }]

  const { data, error } = await supabase.from('pending_work').insert(pieces.map(p => ({
    vehicle_id:       vehicleId,
    title:            p.title,
    description:      p.description,
    priority:         'high',
    status:           'pending',
    identified_date:  inspectionDate,
    due_date:         due,
    // MM/DD/YYYY to match the existing Source entries (and the 10/11 backfill)
    source:           `Failed ${label} inspection ${inspectionDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2/$3/$1')}`,
    assigned_shop_id: shopId || null,
    // The compatibility trigger turns these into the inspection (+ document) source
    source_inspection_fulfillment_id: fulfillmentId,
    source_document_id: documentId || null,
  }))).select('id')
  if (error) throw error
  return data.map(r => r.id)
}

// ── Item 32: split / merge / waiting on / sources ────────────────────────────

/** pieces: [{ title, assigned_to, priority, due_date }] — piece 1 is the item itself. */
export async function splitItem(itemId, pieces) {
  const { data, error } = await supabase.rpc('split_pending_item', { p_item: itemId, p_pieces: pieces })
  if (error) throw error
  return data
}

/** Keep `keepId`; move everything from `mergeId` onto it and cancel `mergeId`. */
export async function mergeItems(keepId, mergeId) {
  const { error } = await supabase.rpc('merge_pending_items', { p_keep: keepId, p_merge: mergeId })
  if (error) throw error
}

export async function addWaitingOn(itemId, blockerId, kind = 'after') {
  const { error } = await supabase.from('pending_work_deps')
    .insert({ pending_work_id: itemId, blocked_by_id: blockerId, kind })
  if (error) throw error
}

export async function removeWaitingOn(depId) {
  const { error } = await supabase.from('pending_work_deps').delete().eq('id', depId)
  if (error) throw error
}

export async function linkSource(itemId, sourceId) {
  const { error } = await supabase.from('pending_work_source_links')
    .upsert({ pending_work_id: itemId, source_id: sourceId },
            { onConflict: 'pending_work_id,source_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function unlinkSource(linkId) {
  const { error } = await supabase.from('pending_work_source_links').delete().eq('id', linkId)
  if (error) throw error
}

/** A free-text source ("Teri", "NTB 05/18/2026"): reuses the vehicle's note with that label. */
export async function noteSourceId(vehicleId, label, date = null) {
  const { data, error } = await supabase.rpc('pending_source_id', {
    p_kind: 'note', p_vehicle_id: vehicleId, p_ref: null, p_label: label.trim(), p_date: date,
  })
  if (error) throw error
  return data
}

/** "Done, nothing to log" */
export async function completeWithoutRecord(pendingWorkId) {
  const { error } = await supabase.from('pending_work')
    .update({ status: 'completed', completed_date: new Date().toISOString().split('T')[0] })
    .eq('id', pendingWorkId)
  if (error) throw error
}

export function invalidatePending(qc, vehicleId) {
  qc.invalidateQueries({ queryKey: ['pending_work'] })
  qc.invalidateQueries({ queryKey: ['pending_work_open'] })
  qc.invalidateQueries({ queryKey: ['pending_work_fleet'] })
  qc.invalidateQueries({ queryKey: ['pending_work_item'] })
  qc.invalidateQueries({ queryKey: ['pending_work_sources'] })
  if (vehicleId) {
    qc.invalidateQueries({ queryKey: ['service_visits',  vehicleId] })
    qc.invalidateQueries({ queryKey: ['service_history', vehicleId] })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pending items ranked against a record title (reuses the 12.2 scorer). */
export function rankPendingItems(record, items) {
  const asSchedule = (items || []).map(p => ({ ...p, service_item: p.title, category: null }))
  return rankScheduleItems(record, asSchedule)
}
export { SUGGEST_THRESHOLD }

/** Due-date chip: red when overdue, amber within a week. null when none/closed. */
export function dueInfo(item) {
  if (!item?.due_date || CLOSED.includes(item.status)) return null
  const d    = parseISO(item.due_date)
  const days = differenceInCalendarDays(d, new Date())
  if (days < 0)  return { days, badge: 'badge-red',   label: `Overdue · due ${format(d, 'M/d')}` }
  if (days <= 7) return { days, badge: 'badge-amber', label: `Due ${format(d, 'EEE M/d')}` }
  return { days, badge: 'badge-slate', label: `Due ${format(d, 'M/d/yy')}` }
}

/**
 * "Waiting on" lines for an item. `blocking` = the item can't start yet:
 *   after          → while the other item is open
 *   only_if_fails  → while the other item is open; once it's completed the
 *                    item is only needed if that didn't fix it ("still needed?")
 * Cancelled blockers no longer block.
 */
export function waitingInfo(item) {
  return (item?.waits_on || []).flatMap(d => {
    const b = d.blocker
    if (!b || b.status === 'cancelled') return []
    const open = !CLOSED.includes(b.status)
    if (d.kind === 'only_if_fails') {
      return [open
        ? { id: d.id, dep: d, blocking: true,  badge: 'badge-slate', text: `Only if “${b.title}” doesn't fix it` }
        : { id: d.id, dep: d, blocking: false, badge: 'badge-amber', text: `“${b.title}” done — still needed?` }]
    }
    return open ? [{ id: d.id, dep: d, blocking: true, badge: 'badge-slate', text: `Waiting on: ${b.title}` }] : []
  })
}

export const isWaiting = item => waitingInfo(item).some(w => w.blocking)

/** The resolving link (latest record date) of an item, if any. */
export function resolvingLink(item) {
  return (item?.pending_work_links || [])
    .filter(l => l.resolves)
    .sort((a, b) => (b.service_records?.service_date || '').localeCompare(a.service_records?.service_date || ''))[0]
}

/** location.state for "Log service visit" from a pending item. */
export function fromPendingState(item) {
  return {
    fromPending: {
      id:              item.id,
      title:           item.title,
      description:     item.description || '',
      assigned_shop_id: item.assigned_shop_id || '',
      shop_is_self:    !!item.assigned_shop?.is_self,
    },
  }
}
