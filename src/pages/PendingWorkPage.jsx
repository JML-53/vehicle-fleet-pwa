/**
 * PendingWorkPage — fleet-wide pending work (item 23).
 * Cards open the item; "Mark done…" offers log / link / done-without-record.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useProfiles } from '@/lib/changeLog'
import { useFleetPendingWork, CLOSED } from '@/lib/pendingWork'
import { useStoredState } from '@/lib/useStoredState'
import PendingCard from '@/components/PendingCard'
import CompletePendingSheet from '@/components/CompletePendingSheet'

export default function PendingWorkPage() {
  const { user } = useAuth()
  const [showClosed, setShowClosed] = useStoredState('pending_show_completed', false)
  const [mineOnly,   setMineOnly]   = useStoredState('pending_assigned_to_me', false)
  const { data = [], isLoading } = useFleetPendingWork({ includeClosed: showClosed })
  const { data: people = {} } = useProfiles()
  const [doneItem, setDoneItem] = useState(null)

  const items    = mineOnly ? data.filter(i => i.assigned_to === user?.id) : data
  const openN    = data.filter(i => !CLOSED.includes(i.status)).length
  const grouped  = useMemo(() => {
    const g = {}
    for (const item of items) {
      const key = item.vehicles?.name || 'Unknown vehicle'
      ;(g[key] ||= { vehicleId: item.vehicle_id, items: [] }).items.push(item)
    }
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])

  const chip = (on) => `px-3 py-1 rounded-full text-xs font-medium transition-colors ${
    on ? 'bg-white text-primary-900' : 'bg-primary-800 text-primary-200 hover:bg-primary-700'}`

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <h1 className="text-xl font-bold">Pending Work</h1>
        <p className="text-primary-300 text-sm mt-0.5">{openN} open items across all vehicles</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" onClick={() => setMineOnly(m => !m)} className={chip(mineOnly)}>
            Assigned to me
          </button>
          <button type="button" onClick={() => setShowClosed(s => !s)} className={chip(showClosed)}>
            Show completed
          </button>
        </div>
      </div>

      <div className="p-4 space-y-5 max-w-2xl mx-auto">
        {isLoading && <p className="text-slate-400 text-sm animate-pulse">Loading…</p>}

        {grouped.map(([vehicleName, { vehicleId, items: vItems }]) => (
          <div key={vehicleName}>
            <Link to={`/vehicles/${vehicleId}?tab=pending`}
              className="card-header hover:text-primary-700 transition-colors block mb-2">
              {vehicleName} ›
            </Link>
            <div className="space-y-3">
              {vItems.map(item => (
                <PendingCard key={item.id} item={item} people={people} onDone={setDoneItem} />
              ))}
            </div>
          </div>
        ))}

        {!isLoading && grouped.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-12">
            {mineOnly ? 'Nothing assigned to you.' : 'No open pending work items.'}
          </p>
        )}
      </div>

      {doneItem && <CompletePendingSheet item={doneItem} onClose={() => setDoneItem(null)} />}
    </div>
  )
}
