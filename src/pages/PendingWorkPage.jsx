/**
 * PendingWorkPage — fleet-wide pending work (items 23 + 23.1).
 * Cards open the item; "Mark done…" offers log / link / done-without-record.
 *
 * 23.1 (Option C): Person filter (Everyone · Me · each family member ·
 * Unassigned), Group by Vehicle | Person with open/done counts per person,
 * sort, and Show completed. URL params ?person=me&group=person apply to this
 * visit only (Dashboard "My work" link) — they don't overwrite the remembered
 * choices, so the tab-bar Pending page still opens the way the user left it.
 *
 * 30: Vehicle filter (remembered), combinable with the person filter.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useProfiles } from '@/lib/changeLog'
import { useFleetPendingWork, CLOSED, priorityRank } from '@/lib/pendingWork'
import { useStoredState } from '@/lib/useStoredState'
import PendingCard from '@/components/PendingCard'
import PendingActionSheet from '@/components/PendingSheets'

const UNASSIGNED = 'unassigned'

const SORTS = {
  priority:   { label: 'Priority',        cmp: (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || byIdentified(a, b) },
  // Item 32: soonest due first; no due date after, by priority
  due:        { label: 'Due date',        cmp: (a, b) => (a.due_date ? 0 : 1) - (b.due_date ? 0 : 1)
                                                         || (a.due_date || '').localeCompare(b.due_date || '')
                                                         || priorityRank(a.priority) - priorityRank(b.priority) },
  identified: { label: 'Date identified', cmp: (a, b) => byIdentified(a, b) },
  completed:  { label: 'Date completed',  cmp: (a, b) => (b.completed_date || '').localeCompare(a.completed_date || '') || byIdentified(a, b) },
}
function byIdentified(a, b) {
  return (b.identified_date || b.created_at || '').localeCompare(a.identified_date || a.created_at || '')
}

export default function PendingWorkPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [savedPerson, savePerson]   = useStoredState('pending_person_filter', 'all')   // all | me | <uuid> | unassigned
  const [savedGroup,  saveGroup]    = useStoredState('pending_group_by', 'vehicle')    // vehicle | person
  const [savedVehicle, setVehicle]  = useStoredState('pending_vehicle_filter', 'all') // all | <vehicle uuid>
  const [sortKey,    setSortKey]    = useStoredState('pending_sort', 'priority')
  const [showClosed, setShowClosed] = useStoredState('pending_show_completed', false)
  const [sheet,      setSheet]      = useState(null)   // { action, item }

  // Deep-link values for this visit only; touching a control drops the override
  const [linked, setLinked] = useState(() => ({ person: params.get('person'), group: params.get('group') }))
  useEffect(() => {
    if (params.get('person') || params.get('group')) setParams({}, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const person  = linked.person ?? savedPerson
  const groupBy = linked.group  ?? savedGroup
  const setPerson  = v => { setLinked(l => ({ ...l, person: null })); savePerson(v) }
  const setGroupBy = v => { setLinked(l => ({ ...l, group:  null })); saveGroup(v) }

  // Always load closed items too: per-person "done" counts need them
  const { data = [], isLoading } = useFleetPendingWork({ includeClosed: true })
  const { data: people = {} } = useProfiles()

  const personId = person === 'me' ? user?.id : person
  const matchesPerson = i =>
    person === 'all' ? true
      : person === UNASSIGNED ? !i.assigned_to
      : i.assigned_to === personId

  // Item 30: vehicles that have any pending work (open or closed), alphabetical
  const vehicles = useMemo(() => {
    const m = new Map()
    for (const i of data) if (i.vehicle_id && !m.has(i.vehicle_id)) m.set(i.vehicle_id, i.vehicles?.name || 'Unknown vehicle')
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [data])
  // A remembered vehicle with no pending work left falls back to All
  const vehicle = savedVehicle !== 'all' && !isLoading && !vehicles.some(v => v.id === savedVehicle) ? 'all' : savedVehicle
  const vehicleName = vehicles.find(v => v.id === vehicle)?.name

  const scoped  = data.filter(i => matchesPerson(i) && (vehicle === 'all' || i.vehicle_id === vehicle))
  const visible = (showClosed ? scoped : scoped.filter(i => !CLOSED.includes(i.status)))
    .slice().sort((SORTS[sortKey] ?? SORTS.priority).cmp)
  const openN   = scoped.filter(i => !CLOSED.includes(i.status)).length

  const nameOf = id => (id ? people[id]?.display_name || 'Unknown' : 'Unassigned')

  const groups = useMemo(() => {
    const g = new Map()
    for (const item of visible) {
      const key = groupBy === 'person' ? (item.assigned_to || UNASSIGNED) : item.vehicle_id
      if (!g.has(key)) g.set(key, [])
      g.get(key).push(item)
    }
    const list = [...g.entries()].map(([key, items]) => {
      if (groupBy === 'person') {
        const all = scoped.filter(i => (i.assigned_to || UNASSIGNED) === key)
        return {
          key, items,
          title: key === UNASSIGNED ? 'Unassigned' : nameOf(key),
          counts: `${all.filter(i => !CLOSED.includes(i.status)).length} open · ${all.filter(i => i.status === 'completed').length} done`,
        }
      }
      return { key, items, title: items[0].vehicles?.name || 'Unknown vehicle', link: `/vehicles/${key}?tab=pending` }
    })
    // People alphabetically with Unassigned last; vehicles alphabetically
    return list.sort((a, b) =>
      (a.key === UNASSIGNED) - (b.key === UNASSIGNED) || a.title.localeCompare(b.title))
  }, [visible, scoped, groupBy, people]) // eslint-disable-line react-hooks/exhaustive-deps

  const sortedPeople = Object.values(people).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
  const chip = on => `px-3 py-1 rounded-full text-xs font-medium transition-colors ${
    on ? 'bg-white text-primary-900' : 'bg-primary-800 text-primary-200 hover:bg-primary-700'}`
  const darkSelect = 'bg-primary-800 text-primary-100 text-xs rounded-full px-3 py-1 border-0 focus:ring-2 focus:ring-primary-400'

  const personLabel = person === 'all' ? ''
    : person === UNASSIGNED ? 'unassigned'
    : person === 'me' ? 'assigned to you'
    : `assigned to ${nameOf(person)}`
  const scopeLabel = [vehicleName ? `on ${vehicleName}` : person === 'all' ? 'across all vehicles' : '', personLabel]
    .filter(Boolean).join(' ')

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <h1 className="text-xl font-bold">Pending Work</h1>
        <p className="text-primary-300 text-sm mt-0.5">{openN} open items {scopeLabel}</p>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <select aria-label="Person" value={person} onChange={e => setPerson(e.target.value)} className={darkSelect}>
            <option value="all">Everyone</option>
            <option value="me">Me</option>
            {sortedPeople.filter(p => p.id !== user?.id).map(p => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
            <option value={UNASSIGNED}>Unassigned</option>
          </select>

          <select aria-label="Vehicle" value={vehicle} onChange={e => setVehicle(e.target.value)} className={darkSelect}>
            <option value="all">All vehicles</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>

          <div className="inline-flex rounded-full bg-primary-800 p-0.5" role="group" aria-label="Group by">
            {[['vehicle', 'By vehicle'], ['person', 'By person']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setGroupBy(k)}
                className={`px-3 py-0.5 rounded-full text-xs font-medium ${
                  groupBy === k ? 'bg-white text-primary-900' : 'text-primary-200 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>

          <select aria-label="Sort" value={sortKey} onChange={e => setSortKey(e.target.value)} className={darkSelect}>
            {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>Sort: {s.label}</option>)}
          </select>

          <button type="button" onClick={() => setShowClosed(s => !s)} className={chip(showClosed)}>
            Show completed
          </button>
        </div>
      </div>

      <div className="p-4 space-y-5 max-w-2xl mx-auto">
        {isLoading && <p className="text-slate-400 text-sm animate-pulse">Loading…</p>}

        {groups.map(g => (
          <div key={g.key}>
            {g.link ? (
              <Link to={g.link} className="card-header hover:text-primary-700 transition-colors block mb-2">
                {g.title} ›
              </Link>
            ) : (
              <h2 className="card-header mb-2 flex items-baseline justify-between gap-2">
                <span>{g.title}</span>
                <span className="text-xs font-normal normal-case tracking-normal text-slate-500">{g.counts}</span>
              </h2>
            )}
            <div className="space-y-3">
              {g.items.map(item => (
                <PendingCard key={item.id} item={item} people={people}
                  onAction={(action, it) => setSheet({ action, item: it })}
                  vehicleName={groupBy === 'person' ? item.vehicles?.name : undefined} />
              ))}
            </div>
          </div>
        ))}

        {!isLoading && groups.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-12">
            {person === 'all' && vehicle === 'all' ? 'No open pending work items.' : `Nothing open ${scopeLabel}.`}
          </p>
        )}
      </div>

      {sheet && <PendingActionSheet {...sheet} onClose={() => setSheet(null)} />}
    </div>
  )
}
