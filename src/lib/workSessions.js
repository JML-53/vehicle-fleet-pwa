/**
 * workSessions — trips to the shop / DIY days that group pending work (item 32).
 *
 * work_sessions + work_session_items (migration 20261015_workflow_sources_sessions.sql).
 * An item is in at most one PLANNED session; closed sessions keep each item's
 * outcome (done / partial / not_done / dropped). Closing out goes through the
 * close_work_session RPC (20261017_work_session_close.sql) in one transaction;
 * afterwards the new records get the same maintenance auto-matching as the
 * visit form (autoMatchIds, item 12.2).
 */
import { useQuery } from '@tanstack/react-query'
import { addDays, endOfWeek, format, parseISO, startOfDay } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { autoMatchIds, syncMaintenanceLinks, invalidateMaintenance } from '@/lib/maintenanceMatch'
import { invalidatePending } from '@/lib/pendingWork'

export const OUTCOME_META = {
  done:     { label: 'Done',             badge: 'badge-green' },
  partial:  { label: 'Partly done',      badge: 'badge-amber' },
  not_done: { label: 'Not done',         badge: 'badge-slate' },
  dropped:  { label: 'No longer needed', badge: 'badge-slate' },
}

export const SESSION_STATUS_META = {
  planned:   { label: 'Planned',   badge: 'badge-blue' },
  closed:    { label: 'Closed',    badge: 'badge-green' },
  cancelled: { label: 'Cancelled', badge: 'badge-slate' },
}

const SESSION_SELECT = `*, shop:shops(id, name, is_self),
  items:work_session_items(id, position, outcome, outcome_note, service_record_id, created_at,
    pending_work(id, title, status, priority, vehicle_id, due_date, assigned_to, description, vehicles(name))),
  visits:service_visits(id, vehicle_id, visit_date, vehicles(name))`

/**
 * Plan-board column for a date: 'week' (through this Sunday, past dates too),
 * 'month' (next 30 days) or 'later' (beyond, or no date). Same rule as /plan.
 */
export function sessionBucket(date, now = new Date()) {
  if (!date) return 'later'
  const today    = startOfDay(now)
  const weekEnd  = startOfDay(endOfWeek(today, { weekStartsOn: 1 }))
  const d        = parseISO(date)
  return d <= weekEnd ? 'week' : d <= addDays(today, 30) ? 'month' : 'later'
}

/** "NTB — tires · Sat 10/17" */
export function sessionLabel(s) {
  if (!s) return ''
  return `${s.title} · ${s.planned_date ? format(parseISO(s.planned_date), 'EEE M/d') : 'no date'}`
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useWorkSessions(status = 'planned') {
  return useQuery({
    queryKey: ['work_sessions', status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_sessions').select(SESSION_SELECT)
        .eq('status', status)
        .order('planned_date', { ascending: status === 'planned', nullsFirst: false })
        .order('created_at')
      if (error) throw error
      return data
    },
    staleTime: 0,
  })
}

export function useWorkSession(id) {
  return useQuery({
    queryKey: ['work_session', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_sessions').select(SESSION_SELECT).eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: !!id,
    staleTime: 0,
  })
}

/** Latest odometer reading per vehicle (close-out hint). */
export function useLastMileage(vehicleIds = []) {
  const ids = [...new Set(vehicleIds)].sort()
  return useQuery({
    queryKey: ['mileage_latest', ids.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mileage_log').select('vehicle_id, mileage, recorded_date')
        .in('vehicle_id', ids).order('recorded_date', { ascending: false })
      if (error) throw error
      const latest = {}
      for (const m of data) if (!latest[m.vehicle_id]) latest[m.vehicle_id] = m
      return latest
    },
    enabled: ids.length > 0,
    staleTime: 0,
  })
}

// ── Writes ───────────────────────────────────────────────────────────────────

const clean = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]))

export async function createSession(fields, itemIds = []) {
  const { data, error } = await supabase.from('work_sessions')
    .insert(clean({ title: fields.title.trim(), planned_date: fields.planned_date, assigned_to: fields.assigned_to,
                    shop_id: fields.shop_id, notes: fields.notes }))
    .select('id').single()
  if (error) throw error
  if (itemIds.length) await addItemsToSession(data.id, itemIds)
  return data.id
}

export async function updateSession(id, fields) {
  const { error } = await supabase.from('work_sessions')
    .update(clean({ title: fields.title?.trim(), planned_date: fields.planned_date, assigned_to: fields.assigned_to,
                    shop_id: fields.shop_id, notes: fields.notes }))
    .eq('id', id)
  if (error) throw error
}

export async function addItemsToSession(sessionId, itemIds) {
  const { count } = await supabase.from('work_session_items')
    .select('id', { count: 'exact', head: true }).eq('session_id', sessionId)
  const { error } = await supabase.from('work_session_items')
    .insert(itemIds.map((pid, i) => ({ session_id: sessionId, pending_work_id: pid, position: (count ?? 0) + i })))
  if (error) throw error
}

/** Take a planned item out of its session (it goes back to the person's Later list). */
export async function removeSessionItem(sessionItemId) {
  const { error } = await supabase.from('work_session_items').delete().eq('id', sessionItemId).is('outcome', null)
  if (error) throw error
}

/** Plan an item into `sessionId`, leaving any other planned session. */
export async function moveItemToSession(itemId, sessionId) {
  const { error } = await supabase.from('work_session_items').delete()
    .eq('pending_work_id', itemId).is('outcome', null)
  if (error) throw error
  await addItemsToSession(sessionId, [itemId])
}

export async function cancelSession(id) {
  const { error } = await supabase.from('work_sessions').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw error
}

/** Close out in one transaction, then auto-match maintenance like the visit form. */
export async function closeSession(id, payload) {
  const { data, error } = await supabase.rpc('close_work_session', { p_session: id, p_payload: payload })
  if (error) throw error

  const byVehicle = {}
  for (const r of data?.records || []) (byVehicle[r.vehicle_id] ??= []).push(r)
  for (const [vehicleId, records] of Object.entries(byVehicle)) {
    const { data: schedule, error: sErr } = await supabase
      .from('maintenance_schedule').select('id, service_item, category').eq('vehicle_id', vehicleId)
    if (sErr) throw sErr
    for (const r of records) {
      const ids = autoMatchIds(r, schedule)
      if (ids.length) await syncMaintenanceLinks(r.id, ids)
    }
  }
  return data
}

export function invalidateSessions(qc, vehicleIds = []) {
  qc.invalidateQueries({ queryKey: ['work_sessions'] })
  qc.invalidateQueries({ queryKey: ['work_session'] })
  qc.invalidateQueries({ queryKey: ['mileage_latest'] })
  qc.invalidateQueries({ queryKey: ['recent_service'] })
  invalidatePending(qc)
  for (const v of new Set(vehicleIds)) {
    invalidatePending(qc, v)
    invalidateMaintenance(qc, v)
    qc.invalidateQueries({ queryKey: ['mileage', v] })
  }
}

/** Rough category for a record title (close-out default; editable). */
export function guessCategory(title = '') {
  const t = title.toLowerCase()
  if (/tire|wheel/.test(t))                          return 'tires'
  if (/brake|rotor|pad/.test(t))                     return 'brakes'
  if (/oil change|oil & filter|oil and filter/.test(t)) return 'oil_change'
  if (/align|sway|control arm|shock|strut|suspension/.test(t)) return 'suspension'
  if (/plug|coil|misfire|timing|engine|lifter/.test(t)) return 'engine'
  if (/fuel|evap/.test(t))                           return 'fuel_system'
  if (/electr|battery|dash|radio/.test(t))           return 'electrical'
  if (/inspection/.test(t))                          return 'inspection'
  if (/registration/.test(t))                        return 'registration'
  return 'other'
}
