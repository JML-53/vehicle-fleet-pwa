/**
 * Item 9.7: tick the other vehicles a reference document also covers (upload
 * and the document page). The vehicle it's filed under isn't offered: it's
 * covered already. onChange must be a useState setter (it gets an updater).
 */
export default function AlsoCoversPicker({ vehicles = [], filedUnder, value = [], onChange }) {
  const others = vehicles.filter(v => v.id !== filedUnder)
  if (!others.length) return null
  // onChange is a state setter: update from the latest list, so quick taps don't undo each other
  const toggle = id => onChange(prev => (prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]))
  return (
    <div>
      <label className="field-label">Also covers</label>
      <div className="flex flex-wrap gap-2">
        {others.map(v => {
          const on = value.includes(v.id)
          return (
            <button key={v.id} type="button" onClick={() => toggle(v.id)} aria-pressed={on}
              className={`text-xs font-medium rounded-full px-3 py-1 border ${on
                ? 'bg-primary-600 border-primary-600 text-white'
                : 'bg-white border-slate-300 text-slate-700 hover:border-primary-500'}`}>
              {v.name}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-slate-400 mt-1">
        It shows on each of these vehicles' Documents tab, and the mechanic can open it from there.
      </p>
    </div>
  )
}
