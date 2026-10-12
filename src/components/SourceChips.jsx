/**
 * SourceChips — where a pending item was reported (item 32): one chip per
 * pending_work_sources row linked to the item. Inspection / document / visit
 * chips open the thing they point at; notes ("Teri", "NTB 05/18/2026") are text.
 * Pass onRemove(link) to show an × on each chip (item form).
 */
import { Link } from 'react-router-dom'
import { ShieldX, FileText, Wrench, CalendarDays, StickyNote, X } from 'lucide-react'

const KIND = {
  inspection:    { Icon: ShieldX,      cls: 'bg-purple-50 border-purple-200 text-purple-800', order: 1 },
  document:      { Icon: FileText,     cls: 'bg-slate-50 border-slate-200 text-slate-700',    order: 2 },
  service_visit: { Icon: Wrench,       cls: 'bg-slate-50 border-slate-200 text-slate-700',    order: 3 },
  work_session:  { Icon: CalendarDays, cls: 'bg-slate-50 border-slate-200 text-slate-700',    order: 4 },
  note:          { Icon: StickyNote,   cls: 'bg-slate-50 border-slate-200 text-slate-700',    order: 5 },
}

export function sourceRoute(vehicleId, s) {
  if (s.kind === 'inspection' && s.inspection_fulfillment_id) return `/vehicles/${vehicleId}/add-inspection?edit=${s.inspection_fulfillment_id}`
  if (s.kind === 'document'   && s.document_id)              return `/documents/${s.document_id}`
  if (s.kind === 'service_visit' && s.service_visit_id)      return `/vehicles/${vehicleId}/visits/${s.service_visit_id}/edit`
  return null
}

/** Chips for any list of { key, source } (the item form passes staged ones too). */
export function SourceChipList({ entries, vehicleId, onRemove, className = '' }) {
  if (!entries?.length) return null
  const sorted = [...entries].sort((a, b) =>
    (KIND[a.source.kind]?.order ?? 9) - (KIND[b.source.kind]?.order ?? 9) || a.source.label.localeCompare(b.source.label))
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {sorted.map(({ key, source }) => {
        const k  = KIND[source.kind] ?? KIND.note
        const to = sourceRoute(vehicleId, source)
        const body = <><k.Icon size={11} className="shrink-0" /><span className="truncate">{source.label}</span></>
        const chip = `inline-flex items-center gap-1 max-w-full text-xs border rounded-md px-1.5 py-0.5 ${k.cls}`
        return (
          <span key={key} className={chip}>
            {to
              ? <Link to={to} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 min-w-0 hover:underline">{body}</Link>
              : <span className="inline-flex items-center gap-1 min-w-0">{body}</span>}
            {onRemove && (
              <button type="button" onClick={e => { e.stopPropagation(); onRemove(key) }}
                aria-label={`Remove source ${source.label}`} className="ml-0.5 -mr-0.5 p-0.5 opacity-60 hover:opacity-100">
                <X size={11} />
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}

export default function SourceChips({ item, onRemove, className }) {
  const entries = (item?.source_links || []).filter(l => l.source).map(l => ({ key: l.id, source: l.source }))
  return <SourceChipList entries={entries} vehicleId={item?.vehicle_id} onRemove={onRemove} className={className} />
}
