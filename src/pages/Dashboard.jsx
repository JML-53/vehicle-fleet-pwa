/**
 * Dashboard (item 31) — layout approved in the "Fleet Workflow Mockups" canvas.
 *
 *   Needs attention   chips only for what needs action: registrations and
 *                     inspections (expired / failed / due soon), overdue items,
 *                     planned sessions whose date has passed. Else "All current".
 *   Vehicles          one table (replaces the old grid + Fleet cards): plate,
 *                     mileage, registration, safety, emissions, open work;
 *                     projects collapsed underneath. Phone: compact rows.
 *   Work              tabs: My work (my sessions by week + my Later list) ·
 *                     Next up (open, not waiting, by due date) · High priority ·
 *                     Recent service. Tab remembered per device.
 *
 * Wide screens: attention across the top, Vehicles ~60% left, Work ~40% right.
 * Phone: attention (collapsible) → Work → Vehicles.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { format, parseISO, startOfDay } from 'date-fns'
import {
  AlertTriangle, CheckCircle, Clock, ShieldCheck, ShieldX, CalendarDays, Wrench, Hourglass, ChevronDown, ChevronRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useProfiles } from '@/lib/changeLog'
import { useStoredState } from '@/lib/useStoredState'
import { useRegistrationStatusAll } from '@/lib/registrations'
import {
  useFleetPendingWork, PRIORITY_META, CLOSED, plannedSession, dueInfo, waitingInfo, isWaiting, laterOrder, priorityRank,
} from '@/lib/pendingWork'
import { useWorkSessions, useLastMileage, sessionBucket, sessionLabel } from '@/lib/workSessions'

// ---- Data hooks ----

function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .order('year', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

function useInspectionStatus() {
  return useQuery({
    queryKey: ['inspection_status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspection_status')
        .select('*')
        .order('days_until_expiry', { ascending: true })
      if (error) throw error
      return data
    },
  })
}

function useRecentService() {
  return useQuery({
    queryKey: ['recent_service'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_records')
        .select(`
          id, vehicle_id, service_date, title, category, total_cost,
          vehicles(id, name, year, make, model)
        `)
        .order('service_date', { ascending: false })
        .limit(8)
      if (error) throw error
      return data
    },
  })
}

// ---- Status cells (registration + inspections) ----

const STATUS_CFG = {
  current:  { text: 'text-green-700',  bg: 'bg-green-50',  Icon: ShieldCheck,   pill: 'bg-green-100 text-green-800' },
  due_soon: { text: 'text-amber-700',  bg: 'bg-amber-50',  Icon: Clock,         pill: 'bg-amber-100 text-amber-800' },
  expired:  { text: 'text-red-700',    bg: 'bg-red-50',    Icon: AlertTriangle, pill: 'bg-red-100 text-red-800' },
  failed:   { text: 'text-purple-700', bg: 'bg-purple-50', Icon: ShieldX,       pill: 'bg-purple-100 text-purple-800' },
  unknown:  { text: 'text-slate-400',  bg: 'bg-slate-50',  Icon: Clock,         pill: 'bg-slate-100 text-slate-500' },
}

function InspectionCell({ row, vehicleId }) {
  if (!row) return <td className="px-2 py-2 text-xs text-slate-300 text-center">—</td>
  const days = row.days_until_expiry
  const status = row.expiry_status || 'unknown'
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.unknown
  const { Icon } = cfg
  const dateStr = row.next_due_date ? format(parseISO(row.next_due_date), 'M/d/yy') : '—'
  const subtext = status === 'failed'
    ? (row.retest_overdue ? `Failed · re-test ${Math.abs(days)}d overdue` : `Failed · re-test by ${dateStr}`)
    : status === 'expired' ? `Exp ${Math.abs(days)}d ago`
    : status === 'due_soon' ? `Due in ${days}d`
    : dateStr
  return (
    <td className={`px-2 py-2 text-center ${cfg.bg}`}>
      <Link to={`/vehicles/${vehicleId}?tab=inspections`} className="flex flex-col items-center gap-0.5">
        <Icon size={13} className={cfg.text} />
        <span className={`text-xs font-medium ${cfg.text}`}>{subtext}</span>
      </Link>
    </td>
  )
}

// Item 26: registration cell, same visual language as the inspection cells
function RegistrationCell({ row }) {
  const status = row?.registration_status || 'unknown'
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.unknown
  const { Icon } = cfg
  const days = row?.days_until_expiry
  const dateStr = row?.expiry_date ? format(parseISO(row.expiry_date), 'M/d/yy') : '—'
  const subtext = status === 'expired' ? `Exp ${Math.abs(days)}d ago`
    : status === 'due_soon' ? `Renew in ${days}d`
    : dateStr
  return (
    <td className={`px-2 py-2 text-center ${cfg.bg}`}>
      <Link to={`/vehicles/${row?.vehicle_id}?tab=registrations`} className="flex flex-col items-center gap-0.5">
        <Icon size={13} className={cfg.text} />
        <span className={`text-xs font-medium ${cfg.text}`}>{subtext}</span>
      </Link>
    </td>
  )
}

function ServiceRow({ record }) {
  const catColors = {
    oil_change: 'badge-green', brakes: 'badge-amber', tires: 'badge-blue', diagnostic: 'badge-amber',
    ac_hvac: 'badge-blue', engine: 'badge-red', suspension: 'badge-amber', modification: 'badge-blue',
  }
  const colorClass = catColors[record.category] || 'badge-slate'
  const label      = record.category?.replace(/_/g, ' ') || 'other'
  return (
    <Link to={`/vehicles/${record.vehicle_id}?tab=service`}
      className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 -mx-4 px-4 transition-colors">
      <span className={`${colorClass} mt-0.5 flex-shrink-0 capitalize`}>{label}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{record.title}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {record.vehicles?.name} · {record.service_date ? format(parseISO(record.service_date), 'MMM d, yyyy') : '—'}
          {record.total_cost ? ` · $${Number(record.total_cost).toLocaleString()}` : ''}
        </p>
      </div>
    </Link>
  )
}

// ---- Needs attention ----

const ATT_STYLE = {
  red:    'bg-red-100 text-red-800 hover:bg-red-200',
  purple: 'bg-purple-100 text-purple-800 hover:bg-purple-200',
  amber:  'bg-amber-100 text-amber-900 hover:bg-amber-200',
}
const ATT_ORDER = { red: 0, purple: 1, amber: 2 }

function buildAttention({ vehicles, inspections, registrations, items, sessions, today }) {
  const out = []
  const active = vehicles.filter(v => v.status === 'active')
  const name = id => vehicles.find(v => v.id === id)?.name || 'Vehicle'
  const fmt = d => format(parseISO(d), 'M/d')

  for (const r of registrations) {
    if (!active.some(v => v.id === r.vehicle_id)) continue
    if (r.registration_status === 'expired')
      out.push({ tone: 'red', text: `${name(r.vehicle_id)} · registration expired${r.expiry_date ? ' ' + fmt(r.expiry_date) : ''}`, to: `/vehicles/${r.vehicle_id}?tab=registrations` })
    else if (r.registration_status === 'due_soon')
      out.push({ tone: 'amber', text: `${name(r.vehicle_id)} · registration due ${fmt(r.expiry_date)}`, to: `/vehicles/${r.vehicle_id}?tab=registrations` })
  }

  // One chip per vehicle and status ("safety & emissions failed")
  for (const v of active) {
    const rows = inspections.filter(i => i.vehicle_id === v.id)
    const by = st => rows.filter(i => i.expiry_status === st)
    const types = rs => rs.map(i => i.inspection_type).join(' & ')
    const failed = by('failed'), expired = by('expired'), soon = by('due_soon')
    const to = `/vehicles/${v.id}?tab=inspections`
    if (failed.length) {
      const overdue = failed.some(i => i.retest_overdue)
      const by_ = failed.map(i => i.next_due_date).filter(Boolean).sort()[0]
      out.push({ tone: 'purple', to, text: `${v.name} · ${types(failed)} failed — ${overdue ? 're-test overdue' : `re-test by ${fmt(by_)}`}` })
    }
    if (expired.length) out.push({ tone: 'red', to, text: `${v.name} · ${types(expired)} inspection expired` })
    if (soon.length)    out.push({ tone: 'amber', to, text: `${v.name} · ${types(soon)} due ${fmt(soon[0].next_due_date)}` })
  }

  const overdue = items.filter(i => i.due_date && parseISO(i.due_date) < today)
  if (overdue.length) out.push({ tone: 'amber', text: `${overdue.length} item${overdue.length > 1 ? 's' : ''} overdue`, to: '/pending' })

  for (const s of sessions.filter(s => s.planned_date && parseISO(s.planned_date) < today))
    out.push({ tone: 'amber', text: `${s.title} — date passed, close it out`, to: `/sessions/${s.id}` })

  return out.sort((a, b) => ATT_ORDER[a.tone] - ATT_ORDER[b.tone])
}

function AttentionStrip({ items, loading }) {
  const [collapsed, setCollapsed] = useStoredState('dash_attention_collapsed', false)
  if (loading) return null
  if (!items.length) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-green-700 font-medium">
        <CheckCircle size={15} /> All current — nothing needs attention
      </p>
    )
  }
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="card-header mb-0">Needs attention · {items.length}</h2>
        <button type="button" onClick={() => setCollapsed(c => !c)} aria-expanded={!collapsed}
          className="sm:hidden text-xs font-semibold text-primary-700 px-2 py-1">{collapsed ? 'Show' : 'Collapse'}</button>
      </div>
      <div className={`${collapsed ? 'hidden sm:flex' : 'flex'} flex-col sm:flex-row sm:flex-wrap gap-2`}>
        {items.map((a, i) => (
          <Link key={i} to={a.to}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${ATT_STYLE[a.tone]}`}>
            {a.text}
          </Link>
        ))}
      </div>
    </section>
  )
}

// ---- Vehicles ----

function Plate({ text }) {
  if (!text) return null
  return (
    <span className="inline-block font-mono text-[11px] font-semibold text-primary-900 border border-primary-800 rounded px-1 leading-4">
      {text}
    </span>
  )
}

function VehiclesSection({ vehicles, inspections, registrations, mileage, openByVehicle }) {
  const [showProjects, setShowProjects] = useState(false)
  const regBy = Object.fromEntries(registrations.map(r => [r.vehicle_id, r]))
  const inspBy = {}
  for (const r of inspections) (inspBy[r.vehicle_id] ??= {})[r.inspection_type] = r
  const active   = vehicles.filter(v => v.status === 'active').sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  const projects = vehicles.filter(v => v.status === 'project').sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  const plate = v => regBy[v.id]?.plate || v.current_plate
  const miles = v => mileage[v.id]
  const projectOpen = projects.reduce((t, v) => t + (openByVehicle[v.id]?.open || 0), 0)

  const OpenWork = ({ v }) => {
    const o = openByVehicle[v.id]
    if (!o?.open) return <span className="text-xs text-slate-400">—</span>
    return (
      <Link to={`/vehicles/${v.id}?tab=pending`} className="inline-flex items-center gap-1.5 text-sm text-slate-800 hover:text-primary-700">
        {o.open}{o.high > 0 && <span className="badge-red">{o.high} high</span>}
      </Link>
    )
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="card-header mb-0">Vehicles</h2>
        <Link to="/vehicles" className="text-xs text-primary-600 hover:underline">All vehicles ›</Link>
      </div>

      {/* Wide: one table */}
      <div className="hidden md:block card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs text-slate-500">
              <th className="px-3 py-2 text-left font-medium">Vehicle</th>
              <th className="px-3 py-2 text-left font-medium">Mileage</th>
              <th className="px-2 py-2 text-center font-medium">Registration</th>
              <th className="px-2 py-2 text-center font-medium">Safety</th>
              <th className="px-2 py-2 text-center font-medium">Emissions</th>
              <th className="px-3 py-2 text-left font-medium">Open work</th>
            </tr>
          </thead>
          <tbody>
            {active.map(v => (
              <tr key={v.id} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-2">
                  <Link to={`/vehicles/${v.id}`} className="font-semibold text-slate-800 hover:text-primary-700">{v.name || `${v.year} ${v.make}`}</Link>
                  <div className="mt-0.5"><Plate text={plate(v)} /></div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {miles(v) ? (
                    <>
                      <span className="text-slate-800">{Number(miles(v).mileage).toLocaleString()}</span>
                      <span className="block text-[11px] text-slate-500">{format(parseISO(miles(v).recorded_date), 'M/d/yy')}</span>
                    </>
                  ) : <span className="text-xs text-slate-400">—</span>}
                </td>
                <RegistrationCell row={regBy[v.id] ?? { vehicle_id: v.id }} />
                <InspectionCell row={inspBy[v.id]?.safety} vehicleId={v.id} />
                <InspectionCell row={inspBy[v.id]?.emissions} vehicleId={v.id} />
                <td className="px-3 py-2"><OpenWork v={v} /></td>
              </tr>
            ))}
            {projects.length > 0 && (
              <tr className="bg-slate-50">
                <td colSpan={6} className="px-3 py-2">
                  <button type="button" onClick={() => setShowProjects(s => !s)} aria-expanded={showProjects}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-primary-700">
                    {showProjects ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    Projects ({projects.length}) · {projects.map(p => p.name).join(', ')} · {projectOpen} open
                  </button>
                </td>
              </tr>
            )}
            {showProjects && projects.map(v => (
              <tr key={v.id} className="border-t border-slate-100 bg-slate-50/50">
                <td className="px-3 py-2" colSpan={5}>
                  <Link to={`/vehicles/${v.id}`} className="font-medium text-slate-700 hover:text-primary-700">{v.name}</Link>
                  <span className="text-xs text-slate-500"> · {v.year} {v.make} {v.model}</span>
                </td>
                <td className="px-3 py-2"><OpenWork v={v} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: compact rows with REG / SAF / EMI pills */}
      <div className="md:hidden card p-0 overflow-hidden">
        {active.map(v => {
          const pill = (label, st) => (
            <span key={label} className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${(STATUS_CFG[st] ?? STATUS_CFG.unknown).pill}`}>{label}</span>
          )
          return (
            <Link key={v.id} to={`/vehicles/${v.id}`} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 min-h-[44px]">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800">{v.name}</div>
                <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                  <Plate text={plate(v)} />
                  {miles(v) && <span>{Number(miles(v).mileage).toLocaleString()} mi</span>}
                  <span>· {openByVehicle[v.id]?.open || 0} open</span>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                {pill('REG', regBy[v.id]?.registration_status)}
                {pill('SAF', inspBy[v.id]?.safety?.expiry_status)}
                {pill('EMI', inspBy[v.id]?.emissions?.expiry_status)}
              </div>
            </Link>
          )
        })}
        {projects.length > 0 && (
          <Link to="/vehicles" className="block px-4 py-3 bg-slate-50 text-sm font-semibold text-primary-700">
            Projects ({projects.length}) · {projects.map(p => p.name).join(', ')} · {projectOpen} open ›
          </Link>
        )}
      </div>
      <p className="md:hidden text-[11px] text-slate-500">REG registration · SAF safety · EMI emissions — green current, amber due soon, red expired, purple failed</p>
    </section>
  )
}

// ---- Work panel ----

// [key, label, short label for phones]
const TABS = [
  ['mine',   'My work',        'My work'],
  ['next',   'Next up',        'Next up'],
  ['high',   'High priority',  'High'],
  ['recent', 'Recent service', 'Recent'],
]

function ItemRow({ item, people, hideWho = false }) {
  const due = dueInfo(item)
  const pr  = PRIORITY_META[item.priority]
  const w   = waitingInfo(item).find(x => x.blocking)
  const who = !hideWho && item.assigned_to && people[item.assigned_to]?.display_name?.split(' ')[0]
  const ses = plannedSession(item)
  return (
    <Link to={`/vehicles/${item.vehicle_id}/add-pending?edit=${item.id}`}
      className={`flex items-start gap-2 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 -mx-4 px-4 transition-colors ${w ? 'opacity-60' : ''}`}>
      <span className="text-[11px] font-semibold text-primary-800 bg-primary-100 rounded px-1.5 mt-0.5 shrink-0">{item.vehicles?.name}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-800">{item.title}</p>
        <p className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-slate-500">
          {due ? <span className={due.badge}>{due.label}</span> : pr && <span className={pr.badge}>{pr.label}</span>}
          {who && <span>{who}</span>}
          {ses && <span className="inline-flex items-center gap-0.5"><CalendarDays size={10} />{sessionLabel(ses.session)}</span>}
          {w && <span className="inline-flex items-center gap-0.5"><Hourglass size={10} />{w.text}</span>}
        </p>
      </div>
    </Link>
  )
}

function SessionLine({ s, today }) {
  const n = (s.items || []).filter(i => i.outcome == null).length
  const past = s.planned_date && parseISO(s.planned_date) < today
  return (
    <Link to={`/sessions/${s.id}`} className="block border border-primary-100 bg-primary-50 hover:border-primary-300 rounded-lg px-3 py-2.5 transition-colors">
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm text-slate-800 truncate">{s.title}</span>
        <span className={past ? 'badge-amber' : 'badge-slate'}>
          {s.planned_date ? format(parseISO(s.planned_date), 'EEE M/d') : 'no date'}{past ? ' · past' : ''}
        </span>
      </span>
      <span className="flex items-center gap-1 text-xs text-slate-600 mt-1">
        <Wrench size={11} />{s.shop?.name || 'DIY'} · {n} item{n === 1 ? '' : 's'}
      </span>
    </Link>
  )
}

function WorkPanel({ userId, items, sessions, people, recent, today }) {
  const [tab, setTab] = useStoredState('dash_work_tab', 'mine')

  const mySessions = sessions.filter(s => s.assigned_to === userId)
  const myLater    = items.filter(i => i.assigned_to === userId && !plannedSession(i)).sort(laterOrder)
  const groups = [['week', 'This week'], ['month', 'Within one month'], ['later', 'Later']]
    .map(([k, label]) => ({ k, label, list: mySessions.filter(s => sessionBucket(s.planned_date) === k) }))
    .filter(g => g.list.length)

  const nextUp = items.filter(i => !isWaiting(i))
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')
      || priorityRank(a.priority) - priorityRank(b.priority) || laterOrder(a, b))
    .slice(0, 8)
  const high = items.filter(i => i.priority === 'high')
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || (a.vehicles?.name || '').localeCompare(b.vehicles?.name || ''))

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="card-header mb-0">Work</h2>
        <Link to="/plan" className="text-xs text-primary-600 hover:underline">Plan board ›</Link>
      </div>
      <div className="card pt-0">
        <div role="tablist" aria-label="Work" className="flex gap-4 border-b border-slate-200 overflow-x-auto -mx-4 px-4">
          {TABS.map(([k, label, short]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} aria-label={label} onClick={() => setTab(k)}
              className={`py-3 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                tab === k ? 'text-primary-900 border-primary-700' : 'text-slate-500 border-transparent hover:text-slate-700'}`}>
              <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <div role="tabpanel" className="pt-3">
          {tab === 'mine' && (
            <div className="space-y-3">
              {groups.map(g => (
                <div key={g.k} className="space-y-1.5">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{g.label}</h3>
                  {g.list.map(s => <SessionLine key={s.id} s={s} today={today} />)}
                </div>
              ))}
              {myLater.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Later · in your order</h3>
                  {myLater.slice(0, 5).map(i => <ItemRow key={i.id} item={i} people={people} hideWho />)}
                  {myLater.length > 5 && (
                    <Link to="/plan" className="block text-xs font-semibold text-primary-700 pt-2">+ {myLater.length - 5} more on the Plan board ›</Link>
                  )}
                </div>
              )}
              {!groups.length && !myLater.length && <p className="text-sm text-slate-400 py-4 text-center">Nothing assigned to you.</p>}
            </div>
          )}

          {tab === 'next' && (
            nextUp.length
              ? <div>{nextUp.map(i => <ItemRow key={i.id} item={i} people={people} />)}
                  <p className="text-xs text-slate-400 pt-2">Open items that aren't waiting on anything, soonest due first.</p></div>
              : <p className="text-sm text-slate-400 py-4 text-center">Nothing ready to start.</p>
          )}

          {tab === 'high' && (
            high.length
              ? <div>{high.map(i => <ItemRow key={i.id} item={i} people={people} />)}</div>
              : <p className="text-sm text-slate-400 py-4 text-center">No high-priority work open.</p>
          )}

          {tab === 'recent' && (
            recent.length
              ? <div>{recent.map(r => <ServiceRow key={r.id} record={r} />)}</div>
              : <p className="text-sm text-slate-400 py-4 text-center">No service records yet.</p>
          )}
        </div>
      </div>
    </section>
  )
}

// ---- Main Dashboard ----

export default function Dashboard() {
  const { profile, user } = useAuth()
  const vehicles      = useVehicles()
  const inspections   = useInspectionStatus()
  const registrations = useRegistrationStatusAll()
  const pending       = useFleetPendingWork()
  const sessions      = useWorkSessions('planned')
  const recent        = useRecentService()
  const { data: people = {} } = useProfiles()

  const today    = useMemo(() => startOfDay(new Date()), [])
  const allVeh   = vehicles.data || []
  const openItems = (pending.data || []).filter(i => !CLOSED.includes(i.status))
  const { data: mileage = {} } = useLastMileage(allVeh.map(v => v.id))

  const openByVehicle = useMemo(() => {
    const m = {}
    for (const i of openItems) {
      const o = (m[i.vehicle_id] ??= { open: 0, high: 0 })
      o.open++
      if (i.priority === 'high') o.high++
    }
    return m
  }, [openItems])

  const attention = buildAttention({
    vehicles: allVeh, inspections: inspections.data || [], registrations: registrations.data || [],
    items: openItems, sessions: sessions.data || [], today,
  })
  const loading = vehicles.isLoading || inspections.isLoading || registrations.isLoading || pending.isLoading

  const hour = new Date().getHours()
  return (
    <div className="flex flex-col">
      <div className="bg-primary-900 text-white px-5 py-5">
        <div className="max-w-7xl mx-auto">
          <p className="text-primary-300 text-xs mb-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          <h1 className="text-xl font-bold">
            Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {profile?.display_name?.split(' ')[0] || 'Joe'}
          </h1>
          <p className="text-primary-200 text-sm mt-1">
            {allVeh.filter(v => v.status === 'active').length} active vehicles ·{' '}
            {allVeh.filter(v => v.status === 'project').length} projects · {openItems.length} open items
          </p>
        </div>
      </div>

      <div className="p-4 lg:px-6 space-y-5 max-w-7xl mx-auto w-full">
        <AttentionStrip items={attention} loading={loading} />

        <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
          {/* Phone: Work first, then Vehicles. Wide: Vehicles ~60% left, Work ~40% right */}
          <div className="order-2 lg:order-1 lg:flex-[3] min-w-0">
            {loading
              ? <p className="text-sm text-slate-400 animate-pulse">Loading…</p>
              : <VehiclesSection vehicles={allVeh} inspections={inspections.data || []}
                  registrations={registrations.data || []} mileage={mileage} openByVehicle={openByVehicle} />}
          </div>
          <div className="order-1 lg:order-2 lg:flex-[2] min-w-0">
            <WorkPanel userId={user?.id} items={openItems} sessions={sessions.data || []}
              people={people} recent={recent.data || []} today={today} />
          </div>
        </div>
      </div>
    </div>
  )
}
