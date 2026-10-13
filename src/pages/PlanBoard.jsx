/**
 * PlanBoard — who's doing what, week by week (item 32 phase 3). Route: /plan
 * Layout approved in the "Fleet Workflow Mockups" canvas + Joe's comments:
 *
 *   rows    = family members (you first) + Unassigned
 *   columns = This week · Within one month (≤ 30 days) · Later
 *   Later   = sessions dated > 1 month out, undated sessions, then items that
 *             aren't in any session in your order (pending_work.rank)
 *
 * Desktop (≥ 1024px): drag with the browser's native drag & drop —
 *   session → another person (reassigns) / another column (asks for the date)
 *   item    → a session card (plans it) · within Later (reorders, reassigns)
 *           · out of a session into Later (unplans it)
 * Phone: one person's lane, ↑ ↓ to reorder Later, "Plan…" to put an item in a session.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { addDays, endOfWeek, startOfWeek, format, parseISO, startOfDay, isSameMonth } from 'date-fns'
import { CalendarDays, Wrench, Hourglass, ChevronUp, ChevronDown, Plus, X, GripVertical } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useProfiles } from '@/lib/changeLog'
import { useStoredState } from '@/lib/useStoredState'
import {
  useFleetPendingWork, plannedSession, CLOSED, PRIORITY_META, dueInfo, waitingInfo, isWaiting,
  laterOrder, saveRanks, setAssignee, invalidatePending,
} from '@/lib/pendingWork'
import {
  useWorkSessions, updateSession, moveItemToSession, removeSessionItem, invalidateSessions,
} from '@/lib/workSessions'
import { PlanSessionSheet, offerCancelIfEmpty } from '@/components/SessionSheets'
import PendingActionSheet from '@/components/PendingSheets'

const UNASSIGNED = 'unassigned'
// Desktop: a long Later list is cut to this many cards (with "Show all N") so one
// person's backlog doesn't push everyone else's row off the screen
const LATER_LIMIT = 6

// ── Time buckets ─────────────────────────────────────────────────────────────

function useBuckets() {
  return useMemo(() => {
    const today     = startOfDay(new Date())
    const weekStart = startOfWeek(today, { weekStartsOn: 1 })
    const weekEnd   = startOfDay(endOfWeek(today, { weekStartsOn: 1 }))
    const monthEnd  = addDays(today, 30)
    const range = (a, b) => isSameMonth(a, b) ? `${format(a, 'MMM d')}–${format(b, 'd')}` : `${format(a, 'MMM d')} – ${format(b, 'MMM d')}`
    const saturday = d => addDays(d, (6 - d.getDay() + 7) % 7)
    return {
      today,
      weekStart,
      list: [
        { key: 'week',  label: 'This week',        hint: range(weekStart, weekEnd) },
        { key: 'month', label: 'Within one month', hint: range(addDays(weekEnd, 1), monthEnd) },
        { key: 'later', label: 'Later',            hint: 'after ' + format(monthEnd, 'MMM d') + ', undated, or not in a session' },
      ],
      of: date => {
        if (!date) return 'later'
        const d = parseISO(date)
        return d <= weekEnd ? 'week' : d <= monthEnd ? 'month' : 'later'
      },
      // Suggested date when a session is dragged into a column
      suggest: key => {
        if (key === 'week') { const s = saturday(today); return format(s <= weekEnd ? s : today, 'yyyy-MM-dd') }
        if (key === 'month') { const s = saturday(addDays(weekEnd, 1)); return format(s <= monthEnd ? s : addDays(weekEnd, 1), 'yyyy-MM-dd') }
        return ''
      },
    }
  }, [])
}

function useIsWide() {
  const q = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = e => setWide(e.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return wide
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PlanBoard() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const wide = useIsWide()
  const buckets = useBuckets()
  const { data: items = [], isLoading } = useFleetPendingWork()
  const { data: planned = [] }  = useWorkSessions('planned')
  const { data: closedS = [] }  = useWorkSessions('closed')
  const { data: people = {} }   = useProfiles()

  const [vehicle,   setVehicle]   = useStoredState('plan_vehicle', 'all')
  const [showLoose, setShowLoose] = useStoredState('plan_show_loose', true)
  const [showDone,  setShowDone]  = useStoredState('plan_show_done', false)
  const [lane,      setLane]      = useStoredState('plan_person', 'me')
  const [planning,  setPlanning]  = useState(false)
  const [sheet,     setSheet]     = useState(null)   // { action, item }
  const [dateAsk,   setDateAsk]   = useState(null)   // { session, bucket, date }
  const [notice,    setNotice]    = useState('')
  const [over,      setOver]      = useState(null)   // highlighted drop target key
  const [busy,      setBusy]      = useState(false)
  const [expanded,  setExpanded]  = useState(() => new Set())   // rows showing their whole Later list
  const drag = useRef(null)

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(t) }, [notice])

  // ── Assemble ──
  const open     = items.filter(i => !CLOSED.includes(i.status))
  const itemById = useMemo(() => new Map(open.map(i => [i.id, i])), [open])
  const okVehicle = vid => vehicle === 'all' || vid === vehicle
  const vehicles = useMemo(() => {
    const m = new Map()
    for (const i of open) m.set(i.vehicle_id, i.vehicles?.name || 'Unknown vehicle')
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [open])

  const loose    = open.filter(i => !plannedSession(i) && okVehicle(i.vehicle_id))
  const sessions = planned.filter(s => vehicle === 'all' || (s.items || []).some(si => okVehicle(si.pending_work?.vehicle_id)))
  const doneThisWeek = showDone
    ? closedS.filter(s => s.closed_at && parseISO(s.closed_at) >= buckets.weekStart)
             .filter(s => vehicle === 'all' || (s.items || []).some(si => okVehicle(si.pending_work?.vehicle_id)))
    : []

  const personKey = id => id || UNASSIGNED
  const sortedPeople = Object.values(people).sort((a, b) =>
    (b.id === user?.id) - (a.id === user?.id) || (a.display_name || '').localeCompare(b.display_name || ''))
  const rows = [...sortedPeople.map(p => ({ key: p.id, name: p.id === user?.id ? `${p.display_name?.split(' ')[0]} (you)` : p.display_name })),
                { key: UNASSIGNED, name: 'Unassigned' }]

  const laneItems = key => loose.filter(i => personKey(i.assigned_to) === key).sort(laterOrder)
  const cell = (key, bucket) => {
    const ss = sessions
      .filter(s => personKey(s.assigned_to) === key && buckets.of(s.planned_date) === bucket)
      .sort((a, b) => (a.planned_date || '9999').localeCompare(b.planned_date || '9999') || a.title.localeCompare(b.title))
    const done = bucket === 'week' ? doneThisWeek.filter(s => personKey(s.assigned_to) === key) : []
    return { sessions: ss, done, items: bucket === 'later' && showLoose ? laneItems(key) : [] }
  }
  const rowCounts = key => {
    const ss = sessions.filter(s => personKey(s.assigned_to) === key)
    const n  = laneItems(key).length + ss.reduce((t, s) => t + (s.items || []).filter(si => si.outcome == null).length, 0)
    return `${n} open · ${ss.length} session${ss.length === 1 ? '' : 's'}`
  }

  // ── Writes ──
  async function run(fn) {
    setBusy(true)
    try { await fn() } catch (e) { setNotice(e.message || 'Something went wrong') }
    finally {
      setBusy(false)
      invalidateSessions(qc)
      invalidatePending(qc)
    }
  }
  const sessionOf = id => planned.find(s => s.id === id)
  const leftIn = (s, sessionItemId) => (s?.items || []).filter(x => x.outcome == null && x.id !== sessionItemId).length
  async function unplan(d) {
    await removeSessionItem(d.sessionItemId)
    const s = sessionOf(d.sessionId)
    await offerCancelIfEmpty(s, leftIn(s, d.sessionItemId))
  }

  function dropOnCell(rowKey, bucket) {
    const d = drag.current; drag.current = null; setOver(null)
    if (!d) return
    if (d.type === 'session') {
      const s = d.session
      run(async () => {
        if (personKey(s.assigned_to) !== rowKey) await updateSession(s.id, { assigned_to: rowKey === UNASSIGNED ? null : rowKey })
        if (buckets.of(s.planned_date) !== bucket) setDateAsk({ session: s, bucket, date: buckets.suggest(bucket) })
      })
      return
    }
    // an item
    if (bucket !== 'later') {
      setNotice('To plan an item for a week, drop it on a session card in that column (or use + Plan a session).')
      return
    }
    run(async () => {
      if (d.sessionItemId) await unplan(d)
      if (personKey(d.item.assigned_to) !== rowKey) await setAssignee(d.item.id, rowKey === UNASSIGNED ? null : rowKey)
    })
  }

  function dropOnSession(s, e) {
    e.stopPropagation()
    const d = drag.current; drag.current = null; setOver(null)
    if (!d) return
    if (d.type === 'session') return dropOnCell(personKey(s.assigned_to), buckets.of(s.planned_date))
    if (d.sessionId === s.id) return
    run(async () => {
      await moveItemToSession(d.item.id, s.id)
      if (d.sessionId) { const old = sessionOf(d.sessionId); await offerCancelIfEmpty(old, leftIn(old, d.sessionItemId)) }
    })
  }

  function dropBefore(rowKey, target, e) {
    e.stopPropagation()
    const d = drag.current; drag.current = null; setOver(null)
    if (!d) return
    if (d.type === 'session') return dropOnCell(rowKey, 'later')
    if (d.item.id === target.id) return
    run(async () => {
      if (d.sessionItemId) await unplan(d)
      if (personKey(d.item.assigned_to) !== rowKey) await setAssignee(d.item.id, rowKey === UNASSIGNED ? null : rowKey)
      const others = laneItems(rowKey).filter(i => i.id !== d.item.id)
      const at = others.findIndex(i => i.id === target.id)
      others.splice(at < 0 ? others.length : at, 0, { ...d.item, rank: null })
      await saveRanks(others)
    })
  }

  function nudge(rowKey, item, dir) {
    const list = laneItems(rowKey)
    const i = list.findIndex(x => x.id === item.id), j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    run(() => saveRanks(list))
  }

  const dragProps = (payload) => wide ? {
    draggable: true,
    onDragStart: e => {
      // An item row sits inside its (also draggable) session card: stop here so
      // the card's handler doesn't replace "this item" with "the whole session"
      e.stopPropagation()
      drag.current = payload
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', payload.item?.id || payload.session?.id)
    },
    onDragEnd: () => { drag.current = null; setOver(null) },
  } : {}
  const dropProps = (key, onDrop) => wide ? {
    onDragOver: e => { e.preventDefault(); if (over !== key) setOver(key) },
    onDrop,
  } : {}

  const totalOpen = loose.length + sessions.reduce((t, s) => t + (s.items || []).filter(si => si.outcome == null).length, 0)
  const darkSelect = 'bg-primary-800 text-primary-100 text-xs rounded-full px-3 py-1.5 border-0 focus:ring-2 focus:ring-primary-400'
  const toggle = on => `px-3 py-1.5 rounded-full text-xs font-semibold ${on ? 'bg-white text-primary-900' : 'bg-primary-800 text-primary-200 hover:bg-primary-700'}`
  const laneKey = lane === 'me' ? (user?.id || UNASSIGNED) : lane

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Plan</h1>
            <p className="text-primary-300 text-sm mt-0.5">Who's doing what, week by week · {totalOpen} open items · {sessions.length} session{sessions.length === 1 ? '' : 's'} planned</p>
          </div>
          <button type="button" onClick={() => setPlanning(true)}
            className="inline-flex items-center gap-1 bg-white text-primary-900 rounded-lg px-3 py-2 text-sm font-bold">
            <Plus size={14} /> Plan a session
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <select aria-label="Vehicle" value={vehicle} onChange={e => setVehicle(e.target.value)} className={darkSelect}>
            <option value="all">All vehicles</option>
            {vehicles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <button type="button" aria-pressed={showLoose} onClick={() => setShowLoose(v => !v)} className={toggle(showLoose)}>Show items not in a session</button>
          <button type="button" aria-pressed={showDone} onClick={() => setShowDone(v => !v)} className={toggle(showDone)}>Show done this week</button>
        </div>
        {!wide && (
          <div className="flex gap-1.5 mt-3 overflow-x-auto" role="group" aria-label="Person">
            {rows.map(r => {
              const on = laneKey === r.key
              return (
                <button key={r.key} type="button" aria-pressed={on} onClick={() => setLane(r.key === user?.id ? 'me' : r.key)}
                  className={`shrink-0 px-3 py-2 rounded-full text-sm ${on ? 'bg-white text-primary-900 font-bold' : 'bg-primary-800 text-primary-100'}`}>
                  {r.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {notice && (
        <div role="status" className="mx-4 mt-3 lg:mx-6 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-3 py-2">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="p-0.5"><X size={14} /></button>
        </div>
      )}
      {isLoading && <p className="p-6 text-sm text-slate-400 animate-pulse">Loading…</p>}

      {/* ── Desktop: people × weeks ── */}
      {!isLoading && wide && (
        <div className={`px-6 py-5 overflow-x-auto ${busy ? 'opacity-70 pointer-events-none' : ''}`}>
          <div className="grid gap-3 min-w-[980px]" style={{ gridTemplateColumns: '150px repeat(3, minmax(260px, 1fr))' }}>
            <div />
            {buckets.list.map(b => (
              <div key={b.key} className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {b.label} <span className="normal-case tracking-normal font-normal">· {b.hint}</span>
              </div>
            ))}
            {rows.map(r => (
              <Row key={r.key}>
                <div className="pt-2">
                  <div className="font-bold text-slate-800">{r.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{rowCounts(r.key)}</div>
                </div>
                {buckets.list.map(b => {
                  const c = cell(r.key, b.key)
                  const key = `${r.key}:${b.key}`
                  return (
                    <div key={key} {...dropProps(key, () => dropOnCell(r.key, b.key))}
                      className={`rounded-xl p-2 min-h-[52px] flex flex-col gap-2 transition-colors ${over === key ? 'bg-primary-100 ring-2 ring-primary-300' : 'bg-[#eef2f9]'}`}>
                      {c.sessions.map(s => (
                        <SessionCard key={s.id} s={s} itemById={itemById} today={buckets.today}
                          dragProps={dragProps({ type: 'session', session: s })}
                          itemDragProps={si => dragProps({ type: 'item', item: itemById.get(si.pending_work.id) ?? si.pending_work, sessionId: s.id, sessionItemId: si.id })}
                          dropProps={dropProps(`s:${s.id}`, e => dropOnSession(s, e))} highlighted={over === `s:${s.id}`} />
                      ))}
                      {c.done.map(s => <SessionCard key={s.id} s={s} itemById={itemById} today={buckets.today} done />)}
                      {(expanded.has(r.key) ? c.items : c.items.slice(0, LATER_LIMIT)).map((it, i) => (
                        <LooseCard key={it.id} item={it} n={i + 1}
                          dragProps={dragProps({ type: 'item', item: it })}
                          dropProps={dropProps(`i:${it.id}`, e => dropBefore(r.key, it, e))} highlighted={over === `i:${it.id}`}
                          onPlan={() => setSheet({ action: 'session', item: it })} />
                      ))}
                      {c.items.length > LATER_LIMIT && (
                        <button type="button"
                          onClick={() => setExpanded(s => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n })}
                          className="text-xs font-semibold text-primary-700 hover:underline self-start px-1">
                          {expanded.has(r.key) ? 'Show fewer' : `Show all ${c.items.length}`}
                        </button>
                      )}
                    </div>
                  )
                })}
              </Row>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 mt-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><GripVertical size={12} /> Drag a session to another person or week · drag an item onto a session to plan it · drag within Later to reorder</span>
            <span><span className="badge-red">red</span> overdue</span>
            <span className="opacity-60">faded = waiting on another item</span>
            <span>1, 2, 3 in Later = the order you plan to tackle unscheduled items</span>
          </div>
        </div>
      )}

      {/* ── Phone: one person's lane ── */}
      {!isLoading && !wide && (
        <div className={`p-4 space-y-5 ${busy ? 'opacity-70 pointer-events-none' : ''}`}>
          {buckets.list.map(b => {
            const c = cell(laneKey, b.key)
            const list = c.items
            return (
              <section key={b.key} className="space-y-2">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {b.label} <span className="normal-case tracking-normal font-normal">· {b.key === 'later' ? 'in your order' : b.hint}</span>
                </h2>
                {!c.sessions.length && !c.done.length && !list.length && <p className="text-sm text-slate-400">Nothing here.</p>}
                {c.sessions.map(s => <SessionCard key={s.id} s={s} itemById={itemById} today={buckets.today} />)}
                {c.done.map(s => <SessionCard key={s.id} s={s} itemById={itemById} today={buckets.today} done />)}
                {list.map((it, i) => (
                  <LooseCard key={it.id} item={it} n={i + 1} onPlan={() => setSheet({ action: 'session', item: it })}
                    onUp={i > 0 ? () => nudge(laneKey, it, -1) : null}
                    onDown={i < list.length - 1 ? () => nudge(laneKey, it, 1) : null} />
                ))}
              </section>
            )
          })}
        </div>
      )}

      {planning && <PlanSessionSheet onClose={() => setPlanning(false)} defaultPerson={wide ? '' : (laneKey === UNASSIGNED ? '' : laneKey)} />}
      {sheet && <PendingActionSheet {...sheet} onClose={() => setSheet(null)} />}
      {dateAsk && (
        <DateDialog ask={dateAsk} label={buckets.list.find(b => b.key === dateAsk.bucket)?.label}
          onCancel={() => setDateAsk(null)}
          onSave={date => { const s = dateAsk.session; setDateAsk(null); run(() => updateSession(s.id, { planned_date: date || null })) }} />
      )}
    </div>
  )
}

// A grid row is just its cells (keeps the 4-column grid flat)
const Row = ({ children }) => <>{children}</>

// ── Cards ────────────────────────────────────────────────────────────────────

function VehChip({ name }) {
  return <span className="inline-block text-[11px] font-semibold text-primary-800 bg-primary-100 rounded px-1.5 whitespace-nowrap">{name}</span>
}

function SessionCard({ s, itemById, today, done, dragProps = {}, itemDragProps, dropProps = {}, highlighted }) {
  const planned = (s.items || []).filter(si => si.pending_work && (done || si.outcome == null))
  const vehicles = new Set(planned.map(si => si.pending_work.vehicle_id)).size
  const past = !done && s.planned_date && parseISO(s.planned_date) < today
  return (
    <div {...dragProps} {...dropProps}
      className={`card p-3 space-y-1.5 ${done ? 'opacity-60' : ''} ${dragProps.draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${highlighted ? 'ring-2 ring-primary-400' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={`/sessions/${s.id}`} className="font-semibold text-sm text-slate-800 hover:text-primary-700">{s.title}</Link>
        {done ? <span className="badge-green">Closed</span>
          : <span className={past ? 'badge-amber' : 'badge-slate'} title={past ? 'Date has passed — close it out or change the date' : undefined}>
              <CalendarDays size={10} className="inline -mt-0.5 mr-0.5" />
              {s.planned_date ? format(parseISO(s.planned_date), 'EEE M/d') : 'no date'}{past ? ' · past' : ''}
            </span>}
      </div>
      <div className="text-xs text-slate-500 flex items-center gap-1">
        <Wrench size={11} />{s.shop?.name || 'DIY'} · {planned.length} item{planned.length === 1 ? '' : 's'}{vehicles > 1 ? ` · ${vehicles} vehicles` : ''}
      </div>
      {planned.map(si => {
        const full = itemById.get(si.pending_work.id) ?? si.pending_work
        const due = !done && dueInfo(full)
        const w = !done && waitingInfo(full).find(x => x.blocking)
        return (
          <div key={si.id} {...(itemDragProps && !done ? itemDragProps(si) : {})}
            className={`flex flex-wrap items-center gap-1.5 text-xs text-slate-700 ${w ? 'opacity-60' : ''} ${itemDragProps && !done ? 'cursor-grab' : ''}`}>
            <VehChip name={full.vehicles?.name ?? si.pending_work.vehicles?.name} />
            <Link to={`/vehicles/${full.vehicle_id}/add-pending?edit=${full.id}`} className="hover:underline">{full.title}</Link>
            {done && si.outcome && <span className="text-slate-500">· {si.outcome.replace('_', ' ')}</span>}
            {due?.days < 0 && <span className="badge-red">Overdue</span>}
            {w && <span className="badge-slate"><Hourglass size={9} className="inline -mt-0.5" /> {w.text.replace(/^Waiting on: /, 'after ')}</span>}
          </div>
        )
      })}
    </div>
  )
}

function LooseCard({ item, n, dragProps = {}, dropProps = {}, highlighted, onPlan, onUp, onDown }) {
  const due = dueInfo(item)
  const pr  = PRIORITY_META[item.priority]
  const w   = waitingInfo(item).find(x => x.blocking)
  return (
    <div {...dragProps} {...dropProps}
      className={`card p-2.5 flex items-center gap-2 ${isWaiting(item) ? 'opacity-60' : ''} ${dragProps.draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${highlighted ? 'ring-2 ring-primary-400' : ''}`}>
      <span className="text-xs font-bold text-slate-400 w-4 text-right shrink-0">{n}</span>
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5 text-xs">
        <VehChip name={item.vehicles?.name} />
        <Link to={`/vehicles/${item.vehicle_id}/add-pending?edit=${item.id}`} className="text-slate-800 font-medium hover:underline">{item.title}</Link>
        {due ? <span className={due.badge}>{due.label}</span> : pr && item.priority !== 'medium' && <span className={pr.badge}>{pr.label}</span>}
        {w && <span className="badge-slate">{w.text}</span>}
      </div>
      {onPlan && (
        <button type="button" onClick={onPlan} title="Put it in a session"
          className="shrink-0 text-xs font-medium text-primary-700 border border-primary-200 rounded-md px-2 py-1.5 hover:bg-primary-50">Plan…</button>
      )}
      {(onUp !== undefined || onDown !== undefined) && (
        <>
          <button type="button" aria-label="Move up" disabled={!onUp} onClick={onUp || undefined}
            className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-30"><ChevronUp size={16} /></button>
          <button type="button" aria-label="Move down" disabled={!onDown} onClick={onDown || undefined}
            className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-30"><ChevronDown size={16} /></button>
        </>
      )}
    </div>
  )
}

function DateDialog({ ask, label, onSave, onCancel }) {
  const [date, setDate] = useState(ask.date)
  return (
    <div className="fixed inset-0 z-50" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/40" />
      <div role="dialog" aria-label="Session date" onClick={e => e.stopPropagation()}
        className="absolute left-1/2 top-1/3 -translate-x-1/2 w-[min(92vw,380px)] bg-white rounded-2xl shadow-xl p-5 space-y-3">
        <p className="font-semibold text-slate-800">Move “{ask.session.title}” to {label}</p>
        <label className="block">
          <span className="field-label">Date</span>
          <input type="date" className="field-input" value={date} onChange={e => setDate(e.target.value)} />
          <span className="text-xs text-slate-400">{ask.bucket === 'later' ? 'Leave blank if it isn’t booked yet.' : 'Pick the day it’s booked for.'}</span>
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="btn-secondary">Keep the old date</button>
          <button type="button" onClick={() => onSave(date)} className="btn-primary">Save date</button>
        </div>
      </div>
    </div>
  )
}
