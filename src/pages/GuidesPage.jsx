/**
 * GuidesPage — every job guide in the fleet (item 29, phase 1b). Route: /guides
 *
 * Group by vehicle (topics A–Z inside) or by topic (vehicles A–Z inside), with
 * a vehicle filter. Choices are remembered in this browser, like Pending Work.
 * The topic is the mechanic's job_type ("Oil change"), compared ignoring case.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { useStoredState } from '@/lib/useStoredState'
import { askMechanic, useVehicleChoices } from '@/lib/mechanic'
import { useAllGuides, guideTopic } from '@/lib/guides'
import { GuideListItem } from '@/components/guides/GuideSections'

const darkSelect = 'bg-primary-800 text-primary-100 text-xs rounded-full px-3 py-1 border-0 focus:ring-2 focus:ring-primary-400'

export default function GuidesPage() {
  const navigate = useNavigate()
  const { data: guides = [], isLoading, error } = useAllGuides()
  const { data: vehicles = [] } = useVehicleChoices()   // every vehicle, so one without guides can get its first
  const [groupBy, setGroupBy] = useStoredState('guides_group_by', 'vehicle')    // vehicle | topic
  const [vehicle, setVehicle] = useStoredState('guides_vehicle_filter', 'all')  // all | <vehicle uuid>

  const groups = useMemo(() => {
    const shown = guides.filter(g => vehicle === 'all' || g.vehicle_id === vehicle)
    const byKey = new Map()
    for (const g of shown) {
      const key   = groupBy === 'topic' ? guideTopic(g).toLowerCase() : g.vehicle_id
      const title = groupBy === 'topic' ? guideTopic(g) : (g.vehicles?.name ?? 'Unknown vehicle')
      if (!byKey.has(key)) byKey.set(key, { key, title, items: [] })
      byKey.get(key).items.push(g)
    }
    // Inside a group, sort by the other key, then title
    const within = groupBy === 'topic'
      ? (a, b) => (a.vehicles?.name ?? '').localeCompare(b.vehicles?.name ?? '') || a.title.localeCompare(b.title)
      : (a, b) => guideTopic(a).localeCompare(guideTopic(b)) || a.title.localeCompare(b.title)
    return [...byKey.values()]
      .map(grp => ({ ...grp, items: grp.items.sort(within) }))
      .sort((a, b) => (a.key === 'other') - (b.key === 'other') || a.title.localeCompare(b.title))
  }, [guides, groupBy, vehicle])

  const shownCount = groups.reduce((n, grp) => n + grp.items.length, 0)

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><BookOpen size={18} /> Guides</h1>
            <p className="text-primary-300 text-sm mt-0.5">
              {shownCount} job guide{shownCount === 1 ? '' : 's'} written by the mechanic
            </p>
          </div>
          <button type="button"
            onClick={() => askMechanic(navigate, {
              vehicleId: vehicle === 'all' ? undefined : vehicle, intent: 'guide', prompt: 'Make a guide for: ',
            })}
            className="shrink-0 inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm px-3 py-1.5 rounded-lg">
            <BookOpen size={14} /> Make a guide
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <div className="inline-flex rounded-full bg-primary-800 p-0.5" role="group" aria-label="Group by">
            {[['vehicle', 'By vehicle'], ['topic', 'By topic']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setGroupBy(k)}
                className={`px-3 py-0.5 rounded-full text-xs font-medium ${
                  groupBy === k ? 'bg-white text-primary-900' : 'text-primary-100 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
          <select aria-label="Vehicle" value={vehicle} onChange={e => setVehicle(e.target.value)} className={darkSelect}>
            <option value="all">All vehicles</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
      </div>

      <div className="p-4 space-y-5 max-w-3xl mx-auto w-full">
        {isLoading && <p className="text-slate-400 text-sm animate-pulse">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error.message}</p>}
        {!isLoading && !error && shownCount === 0 && (
          <p className="text-sm text-slate-500">
            {guides.length
              ? 'No guides for this vehicle yet.'
              : 'No guides yet. Tap Make a guide, or ask the mechanic for one in any chat.'}
          </p>
        )}

        {groups.map(grp => (
          <section key={grp.key}>
            <h2 className="card-header mb-2 flex items-baseline justify-between gap-2">
              <span>{grp.title}</span>
              <span className="text-xs font-normal normal-case tracking-normal text-slate-500">
                {grp.items.length} guide{grp.items.length === 1 ? '' : 's'}
              </span>
            </h2>
            <div className="space-y-3">
              {grp.items.map(g => (
                <GuideListItem key={g.id} guide={g}
                  label={groupBy === 'topic' ? g.vehicles?.name : guideTopic(g)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
