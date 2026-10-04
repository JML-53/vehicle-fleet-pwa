/**
 * MaintenanceLinkPicker — chip picker for "this service record fulfils these
 * maintenance schedule items" (roadmap item 12.2).
 *
 * Suggestions are ranked by maintenanceMatch.scoreMatch against the record's
 * title + category. With autoSelect (new records only), strong matches are
 * ticked automatically until the user toggles a chip themselves.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Wrench, Sparkles, Check } from 'lucide-react'
import { rankScheduleItems, SUGGEST_THRESHOLD, AUTO_THRESHOLD } from '@/lib/maintenanceMatch'

export function useScheduleItems(vehicleId) {
  return useQuery({
    queryKey: ['maintenance_schedule_items', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_schedule')
        .select('id, service_item, category')
        .eq('vehicle_id', vehicleId)
        .order('service_item')
      if (error) throw error
      return data
    },
    enabled: !!vehicleId,
    staleTime: 0,
  })
}

export default function MaintenanceLinkPicker({
  vehicleId, title, category, value = [], onChange, autoSelect = false,
}) {
  const { data: items = [], isLoading } = useScheduleItems(vehicleId)
  const [showAll, setShowAll] = useState(false)
  const touched = useRef(false)

  const ranked = useMemo(
    () => rankScheduleItems({ title, category }, items),
    [title, category, items]
  )

  // Until the user touches a chip, keep the selection equal to the strong matches
  useEffect(() => {
    if (!autoSelect || touched.current || !items.length) return
    const strong = ranked.filter(i => i.score >= AUTO_THRESHOLD).map(i => i.id)
    const same = strong.length === value.length && strong.every(id => value.includes(id))
    if (!same) onChange(strong)
  }, [ranked, autoSelect]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !items.length) return null

  const selected  = new Set(value)
  const visible   = showAll
    ? ranked
    : ranked.filter(i => selected.has(i.id) || i.score >= SUGGEST_THRESHOLD)
  const hiddenCount = ranked.length - visible.length

  function toggle(id) {
    touched.current = true
    onChange(selected.has(id) ? value.filter(v => v !== id) : [...value, id])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
          <Wrench size={11} /> Fulfills Maintenance
        </span>
        {(hiddenCount > 0 || showAll) && (
          <button
            type="button"
            onClick={() => setShowAll(s => !s)}
            className="text-xs text-primary-600 hover:text-primary-800 font-medium"
          >
            {showAll ? 'Show suggestions only' : `Show all (${ranked.length})`}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-slate-400 italic">
          No matching schedule items. Use "Show all" to link one manually.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {visible.map(item => {
            const isOn      = selected.has(item.id)
            const suggested = item.score >= SUGGEST_THRESHOLD
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggle(item.id)}
                title={suggested ? 'Suggested from title / category' : undefined}
                className={
                  'text-xs rounded-full px-2.5 py-1 border flex items-center gap-1 transition-colors ' +
                  (isOn
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : suggested
                      ? 'bg-amber-50 border-amber-300 border-dashed text-amber-800 hover:bg-amber-100'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')
                }
              >
                {isOn ? <Check size={11} /> : suggested && <Sparkles size={11} />}
                {item.service_item}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
