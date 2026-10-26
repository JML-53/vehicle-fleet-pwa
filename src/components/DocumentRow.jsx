/**
 * One document in a list (Documents page, a vehicle's Documents tab; item 9.7):
 * icon, name, where it's filed (General, or other vehicles it also covers),
 * date and type. On a vehicle's tab, pass vehicleId so a document filed under
 * just that vehicle doesn't repeat the vehicle's name.
 */
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ChevronRight } from 'lucide-react'
import { DOC_ICONS, filedLabel } from '@/lib/documents'

export default function DocumentRow({ doc, vehicleId, linkedVisits = 0 }) {
  const onlyThisVehicle = vehicleId && doc.vehicle_id === vehicleId && !(doc.document_vehicles ?? []).length
  const meta = [
    !onlyThisVehicle && filedLabel(doc),
    doc.document_date && format(parseISO(doc.document_date), 'MMM d, yyyy'),
    doc.document_type?.replace(/_/g, ' '),
  ].filter(Boolean).join(' · ')

  return (
    <Link to={`/documents/${doc.id}`}
      className="card flex items-center gap-3 hover:bg-slate-50 transition-colors no-underline">
      <span className="text-2xl flex-shrink-0">{DOC_ICONS[doc.document_type] || '📁'}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-slate-800 truncate">{doc.filename}</p>
        <p className="text-xs text-slate-500 mt-0.5">{meta}</p>
        {doc.description && <p className="text-xs text-slate-600 mt-1 line-clamp-1">{doc.description}</p>}
        {linkedVisits > 0 && (
          <p className="text-xs text-primary-600 font-medium mt-1">
            {linkedVisits} linked visit{linkedVisits !== 1 ? 's' : ''}
          </p>
        )}
      </div>
      <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
    </Link>
  )
}
