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
 */
import { useQuery } from '@tanstack/react-query'
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

export const PENDING_SELECT = `*, ${LINKS_EMBED}, assigned_shop:shops!pending_work_assigned_shop_id_fkey(id, name, is_self)`

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
