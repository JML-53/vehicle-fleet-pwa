/**
 * changeLog — reading audit_log and deletion_requests
 * (migration 20261005_family_access.sql).
 *
 * audit_log is written by the audit_row() trigger on every user-data table,
 * so nothing in the app has to remember to log; this module only reads it,
 * groups it into "sessions" and turns rows into readable sentences.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

// Consecutive changes by one person within this gap form one session card
export const SESSION_GAP_MS = 5 * 60 * 1000
// With no last-seen timestamp yet, count this far back
const DEFAULT_LOOKBACK_DAYS = 7

const v = (row, tab) => row?.vehicle_id ? `/vehicles/${row.vehicle_id}${tab ? `?tab=${tab}` : ''}` : null
const edit = (row, page) => row?.vehicle_id ? `/vehicles/${row.vehicle_id}/${page}?edit=${row.id}` : null

/**
 * Per-table display metadata. `rank` orders a session's headline
 * (lower = more important). `link` returns a route or null.
 */
export const TABLE_META = {
  service_visits:           { noun: 'service visit',     rank: 1, title: r => r.visit_date,                 link: r => r.vehicle_id ? `/vehicles/${r.vehicle_id}/visits/${r.id}/edit` : null },
  inspection_fulfillments:  { noun: 'inspection result', rank: 2, title: r => [r.inspection_date, r.result].filter(Boolean).join(' · '), link: r => v(r, 'inspections') },
  pending_work:             { noun: 'pending work item', rank: 3, title: r => r.title,                      link: r => edit(r, 'add-pending') },
  service_records:          { noun: 'service record',    rank: 4, title: r => r.title,                      link: r => r.vehicle_id ? `/vehicles/${r.vehicle_id}/service/${r.id}/edit` : null },
  documents:                { noun: 'document',          rank: 5, title: r => r.description || r.filename,  link: r => `/documents/${r.id}` },
  diagnostic_codes:         { noun: 'diagnostic code',   rank: 6, title: r => r.code,                       link: r => edit(r, 'add-diagnostic') },
  vehicle_notes:            { noun: 'note',              rank: 7, title: r => r.note_text,                  link: r => edit(r, 'add-note') },
  registrations:            { noun: 'registration',      rank: 8, title: r => [r.plate, r.expiry_date && `exp ${r.expiry_date}`].filter(Boolean).join(' · '), link: r => edit(r, 'add-registration') },
  modifications:            { noun: 'modification',      rank: 9, title: r => r.description,                link: r => edit(r, 'add-mod') },
  maintenance_schedule:     { noun: 'maintenance item',  rank: 10, title: r => r.service_item,              link: r => edit(r, 'add-maintenance') },
  known_specs:              { noun: 'spec',              rank: 11, title: r => r.spec_name,                  link: r => edit(r, 'add-spec') },
  vehicles:                 { noun: 'vehicle',           rank: 12, title: r => r.name,                      link: r => `/vehicles/${r.id}` },
  inspections:              { noun: 'inspection',        rank: 13, title: r => r.inspection_type,           link: r => v(r, 'inspections') },
  roadmap_items:            { noun: 'roadmap item',      rank: 14, title: r => [r.item_number, r.title].filter(Boolean).join(' '), link: r => `/roadmap/${r.id}/edit` },
  shops:                    { noun: 'shop',              rank: 15, title: r => r.name,                      link: () => null },
  profiles:                 { noun: 'user',              rank: 16, title: r => r.display_name,              link: () => null },
  deletion_requests:        { noun: 'deletion request',  rank: 17, title: r => r.label,                     link: r => r.link },
  mileage_log:              { noun: 'mileage reading',   rank: 20, title: r => r.mileage != null ? `${Number(r.mileage).toLocaleString()} mi` : null, link: r => v(r) },
  parts:                    { noun: 'part',              rank: 21, title: r => r.part_name,                 link: () => null },
  maintenance_fulfillments: { noun: 'maintenance link',  rank: 22, title: () => null,                       link: () => null },
  pending_work_links:       { noun: 'pending-work link', rank: 23, title: r => (r.resolves ? 'resolves' : 'worked on'), link: () => null },
}

const VERB   = { INSERT: 'added', UPDATE: 'edited', DELETE: 'deleted' }
const HIDDEN = new Set(['id', 'created_at', 'updated_at', 'last_seen_changes_at'])

export function meta(table) {
  return TABLE_META[table] ?? { noun: table.replace(/_/g, ' '), rank: 99, title: r => r?.title ?? r?.name, link: () => null }
}

export function entryRow(e) {
  return e.new_data ?? e.old_data ?? {}
}

/** "edited service record “Oil Change”" */
export function describeEntry(e) {
  const m = meta(e.table_name)
  let t = m.title(entryRow(e))
  if (t && t.length > 60) t = t.slice(0, 57) + '…'
  return `${VERB[e.op]} ${m.noun}${t ? ` “${t}”` : ''}`
}

export function entryLink(e) {
  return e.op === 'DELETE' ? null : meta(e.table_name).link(entryRow(e))
}

const UUID_RE      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/**
 * [{ field, from, to }] for an UPDATE. Skips bookkeeping and *_id columns;
 * user ids (e.g. resolved_by) become names via `people`, other ids are hidden.
 */
export function entryDiff(e, people = {}) {
  if (e.op !== 'UPDATE') return []
  const isOpaqueId = v => typeof v === 'string' && UUID_RE.test(v) && !people[v]
  return (e.changed_fields || [])
    .filter(f => !HIDDEN.has(f) && !f.endsWith('_id'))
    .filter(f => !isOpaqueId(e.old_data?.[f]) && !isOpaqueId(e.new_data?.[f]))
    .map(f => ({
      field: f.replace(/_/g, ' '),
      from:  fmt(e.old_data?.[f], people),
      to:    fmt(e.new_data?.[f], people),
    }))
}

function fmt(val, people = {}) {
  if (val == null || val === '') return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  const s = String(val)
  if (UUID_RE.test(s) && people[s]) return people[s].display_name
  if (TIMESTAMP_RE.test(s)) {
    const d = new Date(s)
    if (!isNaN(d)) return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
  return s.length > 80 ? s.slice(0, 77) + '…' : s
}

/**
 * Group newest-first entries into sessions: same person, gaps ≤ SESSION_GAP_MS.
 * Each session gets a headline (its most important change) and a tally.
 */
export function groupSessions(entries) {
  const sessions = []
  for (const e of entries) {
    const last = sessions[sessions.length - 1]
    const prevAt = last && new Date(last.entries[last.entries.length - 1].changed_at).getTime()
    if (last && last.changed_by === e.changed_by && prevAt - new Date(e.changed_at).getTime() <= SESSION_GAP_MS) {
      last.entries.push(e)
    } else {
      sessions.push({ key: e.id, changed_by: e.changed_by, entries: [e] })
    }
  }
  for (const s of sessions) {
    s.start      = s.entries[s.entries.length - 1].changed_at
    s.end        = s.entries[0].changed_at
    s.vehicleIds = [...new Set(s.entries.map(e => e.vehicle_id).filter(Boolean))]
    s.headline   = [...s.entries].sort((a, b) => meta(a.table_name).rank - meta(b.table_name).rank)[0]
    const tally = {}
    for (const e of s.entries) {
      const k = `${VERB[e.op]}|${e.table_name}`
      tally[k] = (tally[k] || 0) + 1
    }
    s.tally = Object.entries(tally)
      .map(([k, n]) => { const [verb, table] = k.split('|'); return { verb, table, n, rank: meta(table).rank } })
      .sort((a, b) => a.rank - b.rank)
      .map(({ verb, table, n }) => `${verb} ${n} ${meta(table).noun}${n === 1 ? '' : 's'}`)
  }
  return sessions
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useAuditLog({ days = 30, limit = 300 } = {}) {
  return useQuery({
    queryKey: ['audit_log', days, limit],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 864e5).toISOString()
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .gte('changed_at', since)
        .order('changed_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data
    },
    staleTime: 0,
  })
}

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, display_name, role')
      if (error) throw error
      return Object.fromEntries(data.map(p => [p.id, p]))
    },
    staleTime: 0,
  })
}

/** Changes by others since my last visit to the Changes page (+ pending deletion requests for admin). */
export function useUnseenChangeCount() {
  const { user, profile, isAdmin } = useAuth()
  // Fallback is rounded to midnight so the query key stays stable across
  // renders (a raw Date.now() here re-keys the query every render → fetch loop)
  const lastSeen = profile?.last_seen_changes_at ?? (() => {
    const d = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 864e5)
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  })()

  const { data = 0 } = useQuery({
    queryKey: ['unseen_changes', user?.id, lastSeen, isAdmin],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .gt('changed_at', lastSeen)
        .or(`changed_by.is.null,changed_by.neq.${user.id}`)
      if (error) throw error
      let total = count || 0
      if (isAdmin) {
        const { count: pending, error: drErr } = await supabase
          .from('deletion_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
        if (drErr) throw drErr
        total += pending || 0
      }
      return total
    },
    enabled: !!user && !!profile,
    staleTime: 0,
    refetchInterval: 5 * 60 * 1000,
  })
  return data
}

export function useMarkChangesSeen() {
  const { refreshProfile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_changes_seen')
      if (error) throw error
    },
    onSuccess: async () => {
      await refreshProfile()
      qc.invalidateQueries({ queryKey: ['unseen_changes'] })
    },
  })
}

// ── Deletion requests ────────────────────────────────────────────────────────

export function useDeletionRequests(status = 'pending') {
  return useQuery({
    queryKey: ['deletion_requests', status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deletion_requests')
        .select('*')
        .eq('status', status)
        .order('requested_at', { ascending: false })
      if (error) throw error
      return data
    },
    staleTime: 0,
  })
}

/** The pending request for one row, if any. */
export function usePendingDeletion(table, rowId) {
  return useQuery({
    queryKey: ['deletion_requests', 'row', table, rowId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deletion_requests')
        .select('id, reason, requested_by, requested_at')
        .eq('table_name', table).eq('row_id', rowId).eq('status', 'pending')
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!table && !!rowId,
    staleTime: 0,
  })
}

function invalidateRequests(qc) {
  qc.invalidateQueries({ queryKey: ['deletion_requests'] })
  qc.invalidateQueries({ queryKey: ['unseen_changes'] })
}

export function useRequestDeletion() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ table, rowId, label, vehicleId, link, reason }) => {
      const { error } = await supabase.from('deletion_requests').insert({
        table_name:   table,
        row_id:       rowId,
        label:        label || null,
        vehicle_id:   vehicleId || null,
        link:         link || null,
        reason,
        requested_by: user.id,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateRequests(qc),
  })
}

export function useResolveDeletion() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase
        .from('deletion_requests')
        .update({ status, resolved_by: user.id, resolved_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateRequests(qc),
  })
}
