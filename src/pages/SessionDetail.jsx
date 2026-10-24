/**
 * SessionDetail — one work session (item 32 phase 2b). Route: /sessions/:sessionId
 *
 * Planned: edit who / when / where, items by vehicle (remove, add), Close out…,
 * Cancel session. Closed / cancelled: what was planned vs. what happened
 * (outcome per item) and the visits it logged.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, Plus, Trash2, Pencil, ClipboardCheck, Ban, Wrench, User, CalendarDays, BookOpen } from 'lucide-react'
import { useProfiles } from '@/lib/changeLog'
import { PRIORITY_META, CLOSED, dueInfo } from '@/lib/pendingWork'
import {
  useWorkSession, updateSession, removeSessionItem, cancelSession, invalidateSessions,
  OUTCOME_META, SESSION_STATUS_META,
} from '@/lib/workSessions'
import { SessionFields, AddItemsSheet, offerCancelIfEmpty } from '@/components/SessionSheets'

export default function SessionDetail() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: s, isLoading, error } = useWorkSession(sessionId)
  const { data: people = {} } = useProfiles()
  const [editing, setEditing] = useState(false)
  const [fields, setFields]   = useState(null)
  const [adding, setAdding]   = useState(false)
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')

  useEffect(() => {
    if (s) setFields({ title: s.title, planned_date: s.planned_date || '', assigned_to: s.assigned_to || '', shop_id: s.shop_id || '', notes: s.notes || '' })
  }, [s])

  async function run(fn) {
    setBusy(true); setErr('')
    try { await fn(); invalidateSessions(qc, (s?.items || []).map(i => i.pending_work?.vehicle_id).filter(Boolean)) }
    catch (e) { setErr(e.message || 'Something went wrong') }
    finally { setBusy(false) }
  }

  if (isLoading) return <p className="p-6 text-sm text-slate-400 animate-pulse">Loading session…</p>
  if (error || !s) return <p className="p-6 text-sm text-red-600">{error?.message || 'Session not found.'}</p>

  const planned  = s.status === 'planned'
  const st       = SESSION_STATUS_META[s.status] ?? { label: s.status, badge: 'badge-slate' }
  const items    = (s.items || []).filter(i => i.pending_work)
    .sort((a, b) => (a.pending_work.vehicles?.name || '').localeCompare(b.pending_work.vehicles?.name || '') || a.position - b.position)
  const byVehicle = items.reduce((m, i) => { (m[i.pending_work.vehicles?.name || 'Unknown vehicle'] ??= []).push(i); return m }, {})
  const who = s.assigned_to ? people[s.assigned_to]?.display_name : null

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold">{s.title}</h1>
          <span className={st.badge}>{st.label}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-primary-200">
          <span className="inline-flex items-center gap-1"><CalendarDays size={13} />{s.planned_date ? format(parseISO(s.planned_date), 'EEE, MMM d, yyyy') : 'Not booked yet'}</span>
          <span className="inline-flex items-center gap-1"><User size={13} />{who || 'Nobody yet'}</span>
          <span className="inline-flex items-center gap-1"><Wrench size={13} />{s.shop?.name || 'DIY'}</span>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-2xl mx-auto pb-10">
        {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

        {planned && (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="card-header mb-0">Session details</h2>
              {!editing && (
                <button type="button" onClick={() => setEditing(true)} className="text-xs text-primary-700 inline-flex items-center gap-1">
                  <Pencil size={12} /> Edit
                </button>
              )}
            </div>
            {editing && fields ? (
              <>
                <SessionFields value={fields} onChange={setFields} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy || !fields.title.trim()} className="btn-primary text-sm"
                    onClick={() => run(async () => { await updateSession(s.id, fields); setEditing(false) })}>Save</button>
                  <button type="button" onClick={() => setEditing(false)} className="btn-secondary text-sm">Cancel</button>
                </div>
              </>
            ) : (
              s.notes ? <p className="text-sm text-slate-600 whitespace-pre-line">{s.notes}</p>
                      : <p className="text-xs text-slate-400">Change the date, person or shop with Edit.</p>
            )}
          </div>
        )}

        {/* Items, by vehicle */}
        <div className="space-y-4">
          {!items.length && <p className="text-sm text-slate-400">No items in this session yet.</p>}
          {Object.entries(byVehicle).map(([vehicle, rows]) => (
            <section key={vehicle}>
              <h2 className="card-header mb-2">{vehicle}</h2>
              <div className="card divide-y divide-slate-100 py-1">
                {rows.map(si => {
                  const p   = si.pending_work
                  const pr  = PRIORITY_META[p.priority]
                  const due = planned && dueInfo(p)
                  const out = si.outcome && OUTCOME_META[si.outcome]
                  return (
                    <div key={si.id} className="flex items-start gap-2 py-2">
                      <div className="flex-1 min-w-0">
                        <Link to={`/vehicles/${p.vehicle_id}/add-pending?edit=${p.id}`}
                          className="text-sm font-medium text-slate-800 hover:text-primary-700">{p.title}</Link>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {out && <span className={out.badge}>{out.label}</span>}
                          {!out && pr && <span className={pr.badge}>{pr.label}</span>}
                          {due && <span className={due.badge}>{due.label}</span>}
                          {planned && CLOSED.includes(p.status) && <span className="badge-green">Already {p.status}</span>}
                          {/* Item 29: the job's guide, one tap away on the day */}
                          {p.guide_id && (
                            <Link to={`/guides/${p.guide_id}`}
                              className="inline-flex items-center gap-1 badge-blue hover:underline"><BookOpen size={10} /> Open guide</Link>
                          )}
                        </div>
                        {si.outcome_note && <p className="text-xs text-slate-500 mt-1">{si.outcome_note}</p>}
                      </div>
                      {planned && si.outcome == null && (
                        <button type="button" disabled={busy}
                          onClick={() => run(async () => {
                            await removeSessionItem(si.id)
                            const left = items.filter(x => x.outcome == null && x.id !== si.id).length
                            await offerCancelIfEmpty(s, left)
                          })}
                          aria-label={`Take "${p.title}" out of this session`} title="Take it out of this session (it goes back to the Later list)"
                          className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-md border border-slate-200
                                     text-slate-500 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Visits this session logged */}
        {(s.visits || []).length > 0 && (
          <div className="card space-y-1">
            <h2 className="card-header mb-1">Visits logged</h2>
            {s.visits.map(v => (
              <Link key={v.id} to={`/vehicles/${v.vehicle_id}/visits/${v.id}/edit`} className="block text-sm text-primary-700 hover:underline">
                {v.vehicles?.name} · {format(parseISO(v.visit_date), 'MMM d, yyyy')} ›
              </Link>
            ))}
            <p className="text-xs text-slate-400">Upload the shop invoice to that visit as usual.</p>
          </div>
        )}

        {planned && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAdding(true)} className="btn-secondary inline-flex items-center gap-1">
              <Plus size={14} /> Add items…
            </button>
            <Link to={`/sessions/${s.id}/close`}
              className={`btn-primary inline-flex items-center gap-1 ${items.length ? '' : 'pointer-events-none opacity-50'}`}
              aria-disabled={!items.length}>
              <ClipboardCheck size={14} /> Close out…
            </Link>
            <button type="button" disabled={busy}
              onClick={() => { if (confirm('Cancel this session? Its items go back to their Later lists, marked "not done".')) run(() => cancelSession(s.id)) }}
              className="ml-auto inline-flex items-center gap-1 text-sm font-medium rounded-lg border border-red-200 text-red-700 px-3 py-2 hover:bg-red-50">
              <Ban size={14} /> Cancel session…
            </button>
          </div>
        )}
      </div>

      {adding && <AddItemsSheet session={s} onClose={() => setAdding(false)} />}
    </div>
  )
}
