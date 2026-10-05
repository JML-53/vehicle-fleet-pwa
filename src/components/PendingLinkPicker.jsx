/**
 * PendingLinkPicker — "this service record addresses these pending items"
 * (roadmap item 23). Sits next to MaintenanceLinkPicker on service-record forms.
 *
 * value: [{ pending_work_id, resolves }]
 *   tap a chip      → link (resolves = true by default)
 *   tap ✓ / ◐ badge → toggle "resolves it" vs "worked on, not fixed yet"
 */
import { useMemo, useState } from 'react'
import { ClipboardList, Sparkles, Check, CircleDashed } from 'lucide-react'
import { useVehiclePendingWork, rankPendingItems, SUGGEST_THRESHOLD, CLOSED } from '@/lib/pendingWork'

export default function PendingLinkPicker({ vehicleId, title, value = [], onChange }) {
  const { data: items = [], isLoading } = useVehiclePendingWork(vehicleId, { includeClosed: true })
  const [showAll, setShowAll] = useState(false)

  const linked = useMemo(() => new Map(value.map(l => [l.pending_work_id, l])), [value])

  // Open items, plus closed ones already linked to this record
  const candidates = useMemo(
    () => items.filter(i => !CLOSED.includes(i.status) || linked.has(i.id)),
    [items, linked]
  )
  const ranked = useMemo(() => rankPendingItems({ title }, candidates), [title, candidates])

  if (isLoading || !candidates.length) return null

  const visible = showAll
    ? ranked
    : ranked.filter(i => linked.has(i.id) || i.score >= SUGGEST_THRESHOLD)
  const hidden = ranked.length - visible.length

  function toggleLink(id) {
    onChange(linked.has(id)
      ? value.filter(l => l.pending_work_id !== id)
      : [...value, { pending_work_id: id, resolves: true }])
  }
  function toggleResolves(e, id) {
    e.stopPropagation()
    onChange(value.map(l => l.pending_work_id === id ? { ...l, resolves: !l.resolves } : l))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
          <ClipboardList size={11} /> Addresses Pending Work
        </span>
        {(hidden > 0 || showAll) && (
          <button type="button" onClick={() => setShowAll(s => !s)}
            className="text-xs text-primary-600 hover:text-primary-800 font-medium">
            {showAll ? 'Show suggestions only' : `Show all open (${ranked.length})`}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-slate-400 italic">
          No matching open items. Use "Show all open" to link one.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {visible.map(item => {
            const link      = linked.get(item.id)
            const suggested = item.score >= SUGGEST_THRESHOLD
            return (
              <button key={item.id} type="button" onClick={() => toggleLink(item.id)}
                title={link ? 'Tap to unlink' : suggested ? 'Suggested from title' : 'Tap to link'}
                className={
                  'text-xs rounded-full pl-2.5 pr-1 py-1 border flex items-center gap-1 transition-colors ' +
                  (link
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : suggested
                      ? 'bg-amber-50 border-amber-300 border-dashed text-amber-800 hover:bg-amber-100 pr-2.5'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 pr-2.5')
                }>
                {!link && suggested && <Sparkles size={11} />}
                {item.title}
                {link && (
                  <span role="button" tabIndex={0} onClick={e => toggleResolves(e, item.id)}
                    title={link.resolves ? 'Resolves it — tap if only worked on' : 'Worked on — tap if this resolved it'}
                    className="ml-1 rounded-full bg-white/20 hover:bg-white/30 px-1.5 py-0.5 flex items-center gap-0.5 text-[10px] font-semibold">
                    {link.resolves ? <><Check size={10} /> resolves</> : <><CircleDashed size={10} /> worked on</>}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
