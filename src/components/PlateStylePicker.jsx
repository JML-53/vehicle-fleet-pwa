/**
 * PlateStylePicker — choose a Virginia plate style (item 27).
 * Categories as tabs (instead of one 340-item list) + a search box across all.
 * Thumbnails load from the DMV site while browsing; the chosen style's artwork
 * is cached in our storage on selection (ensurePlateImage).
 */
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Search, RefreshCw, Check } from 'lucide-react'
import { usePlateStyles, syncPlateCatalog, PLATE_CATEGORIES } from '@/lib/registrations'

export default function PlateStylePicker({ value, onChange }) {
  const qc = useQueryClient()
  const { data: styles = [], isLoading } = usePlateStyles()
  const [category, setCategory] = useState('Standard')
  const [query, setQuery]       = useState('')
  const [syncing, setSyncing]   = useState(false)
  const [syncMsg, setSyncMsg]   = useState('')

  const specialty = styles.filter(s => s.category !== 'Standard').length
  const counts = useMemo(() => Object.fromEntries(PLATE_CATEGORIES.map(c => [c, styles.filter(s => s.category === c).length])), [styles])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? styles.filter(s => s.name.toLowerCase().includes(q))
      : styles.filter(s => s.category === category)
  }, [styles, category, query])

  async function sync() {
    setSyncing(true); setSyncMsg('')
    try {
      const r = await syncPlateCatalog()
      setSyncMsg(`Loaded ${r.count} Virginia plate styles.`)
      await qc.invalidateQueries({ queryKey: ['plate_styles'] })
    } catch (e) {
      setSyncMsg(e.message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-2">
      {!isLoading && specialty === 0 && (
        <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p className="text-xs text-amber-800">Specialty styles haven't been loaded from the Virginia DMV yet.</p>
          <button type="button" onClick={sync} disabled={syncing}
            className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-60">
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Loading… (~20s)' : 'Load Virginia plate styles'}
          </button>
        </div>
      )}
      {syncMsg && <p className="text-xs text-slate-500">{syncMsg}</p>}

      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="field-input pl-8 text-sm" placeholder="Search all styles (e.g. Virginia Tech, Purple Heart)"
          value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {!query && (
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
          {PLATE_CATEGORIES.map(c => (
            <button key={c} type="button" onClick={() => setCategory(c)}
              className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors ${
                category === c ? 'bg-primary-700 text-white border-primary-700' : 'bg-white text-slate-600 border-slate-300 hover:border-primary-400'}`}>
              {c}{counts[c] ? ` (${counts[c]})` : ''}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
        {shown.map(s => {
          const on = s.id === value
          return (
            <button key={s.id} type="button" onClick={() => onChange(s)}
              className={`relative text-left rounded-lg border p-1.5 transition-colors ${
                on ? 'border-primary-600 ring-2 ring-primary-200 bg-primary-50' : 'border-slate-200 hover:border-primary-300 bg-white'}`}>
              {s.source_image_url
                ? <img src={s.source_image_url} alt="" loading="lazy" className="w-full aspect-[2/1] object-contain bg-slate-50 rounded" />
                : <div className="w-full aspect-[2/1] rounded bg-white border border-slate-200 flex items-center justify-center text-[10px] text-slate-400">Standard</div>}
              <span className="block text-[11px] leading-tight text-slate-700 mt-1 line-clamp-2">{s.name}</span>
              {on && <Check size={14} className="absolute top-1 right-1 text-primary-600 bg-white rounded-full" />}
            </button>
          )
        })}
        {!shown.length && !isLoading && (
          <p className="col-span-full text-xs text-slate-400 italic py-2">No styles match.</p>
        )}
      </div>
    </div>
  )
}
