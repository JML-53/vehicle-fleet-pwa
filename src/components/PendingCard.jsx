/**
 * PendingCard — one pending work item, shared by the vehicle Pending tab and
 * the fleet-wide Pending Work page (item 23). The whole card opens the item.
 */
import { Link, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Wrench, User, CheckCircle2, CircleDashed, Circle } from 'lucide-react'
import { PRIORITY_META, STATUS_META, CLOSED, resolvingLink } from '@/lib/pendingWork'

function recordLink(vehicleId, rec) {
  if (!rec) return null
  return rec.visit_id
    ? `/vehicles/${vehicleId}/visits/${rec.visit_id}/edit`
    : `/vehicles/${vehicleId}/service/${rec.id}/edit`
}

export default function PendingCard({ item, people = {}, vehicleName, onDone }) {
  const navigate = useNavigate()
  const closed   = CLOSED.includes(item.status)
  const pr       = PRIORITY_META[item.priority] ?? { label: item.priority, badge: 'badge-slate' }
  const st       = STATUS_META[item.status]   ?? { label: item.status,   badge: 'badge-slate' }
  const resolved = resolvingLink(item)
  const workedOn = (item.pending_work_links || []).filter(l => !l.resolves)
  const assignee = item.assigned_to && people[item.assigned_to]?.display_name
  const reporter = item.reported_by && people[item.reported_by]?.display_name
  const open     = () => navigate(`/vehicles/${item.vehicle_id}/add-pending?edit=${item.id}`)

  return (
    <div onClick={open} role="link"
      className={`card cursor-pointer hover:border-primary-300 transition-colors ${closed ? 'opacity-75' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          {vehicleName && <p className="text-xs text-slate-400">{vehicleName}</p>}
          <p className={`font-semibold text-sm ${closed ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800'}`}>
            {item.title}
          </p>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {!closed && <span className={pr.badge}>{pr.label}</span>}
          <span className={st.badge}>{st.label}</span>
        </div>
      </div>

      {item.description && (
        <p className="text-xs text-slate-600 leading-relaxed mb-2 line-clamp-3">{item.description}</p>
      )}

      {(item.assigned_shop || assignee) && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {item.assigned_shop && (
            <span className="badge-slate inline-flex items-center gap-1"><Wrench size={10} />{item.assigned_shop.name}</span>
          )}
          {assignee && (
            <span className="badge-blue inline-flex items-center gap-1"><User size={10} />{assignee}</span>
          )}
        </div>
      )}

      {resolved && (
        <p className="text-xs text-green-700 mb-1 flex items-center gap-1">
          <CheckCircle2 size={12} /> Resolved by{' '}
          <Link to={recordLink(item.vehicle_id, resolved.service_records)} onClick={e => e.stopPropagation()}
            className="underline decoration-green-300 hover:text-green-900">
            {resolved.service_records?.title}
          </Link>
          {item.completed_date && <> · {format(parseISO(item.completed_date), 'MMM d, yyyy')}</>}
        </p>
      )}
      {!resolved && item.status === 'completed' && item.completed_date && (
        <p className="text-xs text-green-700 mb-1">Completed {format(parseISO(item.completed_date), 'MMM d, yyyy')}</p>
      )}
      {workedOn.map(l => (
        <p key={l.id} className="text-xs text-blue-700 mb-1 flex items-center gap-1">
          <CircleDashed size={12} /> Worked on in{' '}
          <Link to={recordLink(item.vehicle_id, l.service_records)} onClick={e => e.stopPropagation()}
            className="underline decoration-blue-300 hover:text-blue-900">
            {l.service_records?.title}
          </Link>
          {l.service_records?.service_date && <> · {format(parseISO(l.service_records.service_date), 'MMM d')}</>}
        </p>
      ))}

      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
          {item.estimated_cost && <span>Est: {item.estimated_cost}</span>}
          {item.source && <span>Source: {item.source}</span>}
          {reporter && <span>Reported by {reporter}</span>}
          {item.identified_date && <span>{format(parseISO(item.identified_date), 'MMM yyyy')}</span>}
        </div>
        {!closed && onDone && (
          // An action, not a status: outlined button + verb + "…" (opens a choice).
          // Green/✓ is reserved for things that ARE done (badges, "Resolved by").
          <button type="button" onClick={e => { e.stopPropagation(); onDone(item) }}
            title="Mark this item done — log the visit, link a record, or close it"
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap
                       px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-700
                       hover:border-primary-400 hover:text-primary-700 hover:bg-primary-50 transition-colors">
            <Circle size={12} /> Mark done…
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * "Resolves: …" / "Worked on: …" chips on a service record, linking back to
 * the pending items it addressed (the other half of the two-way link).
 */
export function PendingLinkBadges({ links = [], vehicleId }) {
  if (!links.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {links.filter(l => l.pending_work).map(l => (
        <Link key={l.pending_work.id}
          to={`/vehicles/${vehicleId}/add-pending?edit=${l.pending_work.id}`}
          onClick={e => e.stopPropagation()}
          className={`${l.resolves ? 'badge-green' : 'badge-blue'} inline-flex items-center gap-1 hover:opacity-80`}>
          {l.resolves ? <CheckCircle2 size={10} /> : <CircleDashed size={10} />}
          {l.resolves ? 'Resolves' : 'Worked on'}: {l.pending_work.title}
        </Link>
      ))}
    </div>
  )
}
