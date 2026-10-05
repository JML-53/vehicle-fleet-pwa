/**
 * ChangesPage — running change log + deletion-request review.
 * Route: /changes
 *
 * Every insert/update/delete on user-data tables is captured by the
 * audit_row() trigger; this page groups them into per-person "sessions".
 * Opening the page marks changes as seen (clears the nav counter).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO, isToday, isYesterday } from 'date-fns'
import { ChevronDown, ChevronRight, ExternalLink, Flag, X, History } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import {
  useAuditLog, useProfiles, useMarkChangesSeen, useDeletionRequests, useResolveDeletion,
  groupSessions, describeEntry, entryLink, entryDiff, meta,
} from '@/lib/changeLog'

function useVehicleNames() {
  return useQuery({
    queryKey: ['vehicle_names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('id, name')
      if (error) throw error
      return Object.fromEntries(data.map(v => [v.id, v.name]))
    },
    staleTime: 0,
  })
}

function dayLabel(ts) {
  const d = parseISO(ts)
  if (isToday(d))     return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'EEEE, MMM d')
}

// ── Deletion requests ────────────────────────────────────────────────────────

function useRequestedRows(requests) {
  return useQuery({
    queryKey: ['deletion_request_rows', requests.map(r => r.id)],
    queryFn: async () => {
      const rows = {}
      await Promise.all(requests.map(async r => {
        const { data } = await supabase.from(r.table_name).select('*').eq('id', r.row_id).maybeSingle()
        rows[r.id] = data
      }))
      return rows
    },
    enabled: requests.length > 0,
    staleTime: 0,
  })
}

function DeletionRequests({ people, vehicles }) {
  const { isAdmin } = useAuth()
  const { data: requests = [] } = useDeletionRequests('pending')
  const { data: rows = {} }     = useRequestedRows(requests)
  const resolve = useResolveDeletion()

  if (!requests.length) return null
  return (
    <div className="card border border-amber-200 bg-amber-50 space-y-2">
      <h2 className="card-header text-amber-800 flex items-center gap-1.5">
        <Flag size={14} /> Deletion requests ({requests.length})
      </h2>
      {!isAdmin && <p className="text-xs text-amber-700">Waiting for Joe to review.</p>}
      {requests.map(r => {
        const m    = meta(r.table_name)
        const row  = rows[r.id]
        const name = m.title(row || {}) || r.label
        const link = (row && m.link(row)) || r.link
        return (
          <div key={r.id} className="bg-white rounded-lg border border-amber-100 p-3 text-sm space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-medium text-slate-800">{people[r.requested_by]?.display_name || 'Someone'}</span>
                <span className="text-slate-600"> wants to delete {m.noun}</span>
                {name && <span className="text-slate-800"> “{name}”</span>}
                {r.vehicle_id && vehicles[r.vehicle_id] && <span className="text-slate-500"> · {vehicles[r.vehicle_id]}</span>}
              </div>
              <span className="text-xs text-slate-400 whitespace-nowrap">{format(parseISO(r.requested_at), 'MMM d, h:mm a')}</span>
            </div>
            <p className="text-slate-600 italic">“{r.reason}”</p>
            {row === null && <p className="text-xs text-slate-400">This item no longer exists.</p>}
            {isAdmin && (
              <div className="flex gap-2 pt-1">
                {link && row && (
                  <Link to={link} className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1">
                    <ExternalLink size={12} /> Open &amp; delete
                  </Link>
                )}
                <button type="button"
                  onClick={() => resolve.mutate({ id: r.id, status: 'rejected' })}
                  className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1">
                  <X size={12} /> {row === null ? 'Dismiss' : 'Reject'}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Session card ─────────────────────────────────────────────────────────────

function SessionCard({ session, people, vehicles, isNew }) {
  const [open, setOpen] = useState(false)
  const who      = session.changed_by ? (people[session.changed_by]?.display_name || 'Unknown') : 'System'
  const vehNames = session.vehicleIds.map(id => vehicles[id]).filter(Boolean)
  const start    = parseISO(session.start)
  const end      = parseISO(session.end)
  const time     = format(start, 'h:mm a') + (end - start > 60000 ? `–${format(end, 'h:mm a')}` : '')

  return (
    <div className={`card p-3 ${isNew ? 'border-l-4 border-l-primary-500' : ''}`}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left flex gap-3 items-start">
        <span className="w-8 h-8 shrink-0 rounded-full bg-primary-100 text-primary-800 flex items-center justify-center text-sm font-semibold">
          {who[0]}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-slate-800">{who}</span>
            {vehNames.length > 0 && <span className="text-sm text-slate-500">{vehNames.join(', ')}</span>}
            <span className="text-xs text-slate-400">{time}</span>
            {isNew && <span className="badge-blue" style={{ fontSize: '10px' }}>new</span>}
          </span>
          <span className="block text-sm text-slate-700">{describeEntry(session.headline)}</span>
          {session.entries.length > 1 && (
            <span className="block text-xs text-slate-500">{session.tally.join(' · ')}</span>
          )}
        </span>
        <span className="text-slate-400 pt-1">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>

      {open && (
        <ul className="mt-2 ml-11 space-y-2 border-l border-slate-100 pl-3">
          {session.entries.map(e => {
            const link = entryLink(e)
            const diff = entryDiff(e, people)
            return (
              <li key={e.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-slate-700">{describeEntry(e)}</span>
                  <span className="text-xs text-slate-400">{format(parseISO(e.changed_at), 'h:mm a')}</span>
                  {link && <Link to={link} className="text-primary-500 hover:text-primary-700"><ExternalLink size={12} /></Link>}
                </div>
                {diff.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5">
                    {diff.map(d => (
                      <li key={d.field} className="text-xs text-slate-500">
                        <span className="font-medium text-slate-600">{d.field}:</span>{' '}
                        <span className="line-through text-red-400">{d.from}</span>{' → '}
                        <span className="text-green-700">{d.to}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChangesPage() {
  const { user, profile } = useAuth()
  const { data: entries = [], isLoading, error } = useAuditLog()
  const { data: people = {} }   = useProfiles()
  const { data: vehicles = {} } = useVehicleNames()
  const markSeen = useMarkChangesSeen()

  const [hideMine, setHideMine] = useState(true)
  const [vehicle,  setVehicle]  = useState('')
  const [person,   setPerson]   = useState('')

  // Remember what "new" meant when the page opened, then mark everything seen
  const seenBefore = useRef(undefined)
  if (seenBefore.current === undefined && profile) seenBefore.current = profile.last_seen_changes_at || null
  useEffect(() => {
    if (profile && !markSeen.isPending && !markSeen.isSuccess) markSeen.mutate()
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  const sessions = useMemo(() => {
    const filtered = entries.filter(e =>
      (!hideMine || e.changed_by !== user?.id) &&
      (!vehicle  || e.vehicle_id === vehicle) &&
      (!person   || e.changed_by === person))
    return groupSessions(filtered)
  }, [entries, hideMine, vehicle, person, user])

  const byDay = useMemo(() => {
    const days = []
    for (const s of sessions) {
      const label = dayLabel(s.end)
      if (days[days.length - 1]?.label !== label) days.push({ label, sessions: [] })
      days[days.length - 1].sessions.push(s)
    }
    return days
  }, [sessions])

  const isNew = s => !!seenBefore.current && s.end > seenBefore.current && s.changed_by !== user?.id

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <h1 className="text-xl font-bold flex items-center gap-2"><History size={18} /> Changes</h1>
        <p className="text-primary-300 text-sm mt-0.5">
          Everything added, edited or deleted in the last 30 days
          {seenBefore.current && ` · last visit ${format(parseISO(seenBefore.current), 'MMM d, h:mm a')}`}
        </p>
      </div>

      <div className="p-4 space-y-4 max-w-3xl mx-auto w-full">
        <DeletionRequests people={people} vehicles={vehicles} />

        <div className="flex flex-wrap items-center gap-2">
          <select className="field-select w-auto text-sm" value={vehicle} onChange={e => setVehicle(e.target.value)}>
            <option value="">All vehicles</option>
            {Object.entries(vehicles).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select className="field-select w-auto text-sm" value={person} onChange={e => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {Object.values(people).map(p => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 ml-auto">
            <input type="checkbox" checked={hideMine} onChange={e => setHideMine(e.target.checked)} />
            Hide my changes
          </label>
        </div>

        {isLoading && <p className="text-sm text-slate-400 animate-pulse">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error.message}</p>}
        {!isLoading && !error && byDay.length === 0 && (
          <p className="text-sm text-slate-400 italic">
            No changes to show{hideMine ? ' from others' : ''} in the last 30 days.
          </p>
        )}

        {byDay.map(day => (
          <div key={day.label} className="space-y-2">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{day.label}</h2>
            {day.sessions.map(s => (
              <SessionCard key={s.key} session={s} people={people} vehicles={vehicles} isNew={isNew(s)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
