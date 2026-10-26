import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { enumLabel } from '@/lib/enums'
import { useVehiclePendingWork, useInspectionRepairItems, CLOSED } from '@/lib/pendingWork'
import { useProfiles } from '@/lib/changeLog'
import { useStoredState } from '@/lib/useStoredState'
import PendingCard, { PendingLinkBadges } from '@/components/PendingCard'
import SourceDocLink from '@/components/SourceDocLink'
import LicensePlate from '@/components/LicensePlate'
import { useRegistrationStatus, REG_STATUS_META, plateImageUrl } from '@/lib/registrations'
import PendingActionSheet from '@/components/PendingSheets'
import { format, parseISO, isBefore, addDays } from 'date-fns'
import { Plus, ArrowLeft, Gauge, Pencil, Upload, Link2, ChevronDown, ChevronUp, ShieldCheck, ShieldX, AlertTriangle, Clock, CircleDot, MessagesSquare, ShieldAlert, CheckCircle2, BookOpen } from 'lucide-react'
import { askMechanic, isUnverified, SPEC_SOURCE_LABEL, VERIFICATION_LABEL, hostname } from '@/lib/mechanic'
import { useGuides } from '@/lib/guides'
import { GuideListItem } from '@/components/guides/GuideSections'
import { useVehicleDocuments, isReference } from '@/lib/documents'
import DocumentRow from '@/components/DocumentRow'
import { useAuth } from '@/contexts/AuthContext'

// ---- Data hooks ----

const useVehicle = id => useQuery({
  queryKey: ['vehicle', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('vehicles').select('*').eq('id', id).single()
    if (error) throw error
    return data
  },
  enabled: !!id,
})

const useCurrentMileage = id => useQuery({
  queryKey: ['mileage', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('vehicle_current_mileage').select('*').eq('vehicle_id', id).single()
    if (error && error.code !== 'PGRST116') throw error
    return data
  },
  enabled: !!id,
})

const useServiceHistory = id => useQuery({
  queryKey: ['service_history', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('service_records')
      .select(`
        *,
        service_visits(visit_date, work_order, invoice_number, technician, total_cost, source_document_id, shops(name, phone)),
        pending_work_links(resolves, pending_work(id, title)),
        parts(id, part_name, part_number, manufacturer, vendor, order_number, quantity, unit_cost, total_cost)
      `)
      .eq('vehicle_id', id)
      .order('service_date', { ascending: false })
    if (error) throw error
    return data
  },
  enabled: !!id,
})

const useServiceVisits = id => useQuery({
  queryKey: ['service_visits', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('service_visits')
      .select(`
        *,
        shops(name, phone),
        service_records(id, title, category, description, labor_cost, parts_cost, total_cost, notes,
          pending_work_links(resolves, pending_work(id, title)),
          parts(id, part_name, part_number, manufacturer, vendor, quantity, unit_cost, total_cost))
      `)
      .eq('vehicle_id', id)
      .order('visit_date', { ascending: false })
    if (error) throw error
    return data
  },
  enabled: !!id,
})

const useMaintenance = id => useQuery({
  queryKey: ['maintenance', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('maintenance_due_soon')
      .select('*')
      .eq('vehicle_id', id)
      .order('priority')
    if (error) throw error
    return data
  },
  enabled: !!id,
})

const useMods = id => useQuery({
  queryKey: ['modifications', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('modifications')
      .select('*, shops(name)')
      .eq('vehicle_id', id)
      .order('mod_date', { ascending: false })
    if (error) throw error
    return data
  },
  enabled: !!id,
})

const useNotes = id => useQuery({
  queryKey: ['vehicle_notes', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('vehicle_notes')
      .select('*')
      .eq('vehicle_id', id)
      .order('is_pinned', { ascending: false })
      .order('note_date', { ascending: false })
    if (error) throw error
    return data
  },
  enabled: !!id,
})

const useSpecs = id => useQuery({
  queryKey: ['known_specs', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('known_specs')
      .select('*')
      .eq('vehicle_id', id)
      .order('spec_category')
    if (error) throw error
    return data
  },
  enabled: !!id,
})

const useRegistrations = id => useQuery({
  queryKey: ['registrations', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('registrations').select('*, plate_styles(name, image_path)').eq('vehicle_id', id)
      .order('expiry_date', { ascending: false })
    if (error) throw error
    return data
  },
  enabled: !!id,
})

const useDiagnosticCodes = id => useQuery({
  queryKey: ['diagnostic_codes', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('diagnostic_codes')
      .select('*')
      .eq('vehicle_id', id)
      .order('pulled_date', { ascending: false })
    if (error) throw error
    return data
  },
  enabled: !!id,
})

// ---- Tab content components ----

const CAT_COLORS = {
  oil_change: 'badge-green', brakes: 'badge-amber', tires: 'badge-blue',
  diagnostic: 'badge-amber', ac_hvac: 'badge-blue', engine: 'badge-red',
  suspension: 'badge-amber', modification: 'badge-blue', fuel_system: 'badge-blue',
  inspection: 'badge-green', cooling: 'badge-blue', electrical: 'badge-amber',
  transmission: 'badge-blue',
}

function PartsTable({ parts }) {
  if (!parts?.length) return null
  return (
    <div className="mt-2 bg-slate-50 rounded-lg overflow-hidden border border-slate-100">
      <p className="text-xs font-semibold text-slate-500 px-3 pt-2 pb-1">Parts</p>
      <table className="w-full text-xs">
        <tbody>
          {parts.map(p => (
            <tr key={p.id} className="border-t border-slate-100">
              <td className="px-3 py-1.5 text-slate-700 font-medium">
                {p.part_name}
                {p.part_number && <span className="text-slate-400 ml-1 font-mono">#{p.part_number}</span>}
              </td>
              <td className="px-3 py-1.5 text-slate-500">{p.manufacturer || ''}</td>
              <td className="px-3 py-1.5 text-slate-500 text-right">
                {p.quantity !== 1 ? `×${p.quantity} ` : ''}
                {p.total_cost != null ? `$${Number(p.total_cost).toLocaleString()}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ServiceHistoryTab({ vehicleId }) {
  const { data, isLoading } = useServiceHistory(vehicleId)
  const [expanded, setExpanded] = useState({})
  const navigate = useNavigate()

  if (isLoading) return <Loading />
  if (!data?.length) return <Empty message="No service records yet." />

  return (
    <div className="space-y-3">
      {data.map(r => (
        <div key={r.id} className="card">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="font-semibold text-slate-800 text-sm">{r.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {r.service_date ? format(parseISO(r.service_date), 'MMM d, yyyy') : '—'}
                {r.service_visits?.shops?.name ? ` · ${r.service_visits.shops.name}` : ''}
                {r.service_visits?.work_order ? ` · WO ${r.service_visits.work_order}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className={`${CAT_COLORS[r.category] || 'badge-slate'} capitalize`}>
                {r.category?.replace(/_/g, ' ')}
              </span>
              <button
                onClick={() => navigate(`/vehicles/${vehicleId}/service/${r.id}/edit`)}
                className="text-slate-400 hover:text-primary-600 p-0.5"
                title="Edit service record"
              >
                <Pencil size={12} />
              </button>
            </div>
          </div>

          {r.description && (
            <p className="text-xs text-slate-600 mb-2 leading-relaxed">{r.description}</p>
          )}
          <PendingLinkBadges links={r.pending_work_links} vehicleId={vehicleId} />
          <SourceDocLink documentId={r.service_visits?.source_document_id} className="mb-2" />

          <div className="flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-4">
              {r.total_cost != null && (
                <span className="font-medium text-slate-700">
                  ${Number(r.total_cost).toLocaleString()}
                </span>
              )}
              {r.notes && <span className="italic truncate max-w-[200px]">{r.notes}</span>}
            </div>
            {r.parts?.length > 0 && (
              <button
                onClick={() => setExpanded(p => ({ ...p, [r.id]: !p[r.id] }))}
                className="text-primary-600 hover:text-primary-800 text-xs font-medium"
              >
                {expanded[r.id] ? '▲ Hide' : `▼ Parts (${r.parts.length})`}
              </button>
            )}
          </div>

          {expanded[r.id] && <PartsTable parts={r.parts} />}
        </div>
      ))}
    </div>
  )
}

function ServiceVisitsTab({ vehicleId }) {
  const { data, isLoading } = useServiceVisits(vehicleId)
  const [expanded, setExpanded] = useState({})
  const navigate = useNavigate()

  if (isLoading) return <Loading />
  if (!data?.length) return <Empty message="No service visits recorded." />

  // Group visits by year, descending
  const byYear = (data || []).reduce((acc, visit) => {
    const year = visit.visit_date ? visit.visit_date.slice(0, 4) : 'Unknown'
    if (!acc[year]) acc[year] = []
    acc[year].push(visit)
    return acc
  }, {})
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a))

  const VisitCard = ({ visit }) => {
    const isOpen  = expanded[visit.id]
    const records = visit.service_records || []
    return (
      <div className="card">
        {/* Visit header */}
        <div className="flex items-start gap-2">
          <button
            className="flex-1 text-left"
            onClick={() => setExpanded(p => ({ ...p, [visit.id]: !p[visit.id] }))}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                {/* Item 24: what the visit was for, then when/where */}
                <p className="font-semibold text-slate-800 text-sm">
                  {visit.title || (visit.visit_date ? format(parseISO(visit.visit_date), 'MMM d, yyyy') : '—')}
                </p>
                {visit.title && (
                  <p className="text-xs text-slate-600 mt-0.5">
                    {visit.visit_date ? format(parseISO(visit.visit_date), 'MMM d, yyyy') : '—'}
                    {visit.shops?.name ? ` · ${visit.shops.name}` : ''}
                  </p>
                )}
                {!visit.title && visit.shops?.name && (
                  <p className="text-xs text-slate-600 mt-0.5">{visit.shops.name}</p>
                )}
                <p className="text-xs text-slate-500 mt-0.5">
                  {records.length} service item{records.length !== 1 ? 's' : ''}
                  {visit.work_order ? ` · WO ${visit.work_order}` : ''}
                  {visit.invoice_number ? ` · Inv ${visit.invoice_number}` : ''}
                  {visit.total_cost != null ? ` · $${Number(visit.total_cost).toLocaleString()}` : ''}
                </p>
                <SourceDocLink documentId={visit.source_document_id} className="mt-1" />
              </div>
              <span className="text-slate-400 text-lg leading-none mt-0.5">
                {isOpen ? '▲' : '▼'}
              </span>
            </div>
          </button>
          <button
            onClick={() => navigate(`/vehicles/${vehicleId}/visits/${visit.id}/edit`)}
            className="text-slate-400 hover:text-primary-600 p-1 flex-shrink-0 mt-0.5"
            title="Edit this visit"
          >
            <Pencil size={13} />
          </button>
        </div>

        {/* Expanded records */}
        {isOpen && (
          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
            {records.length === 0 && (
              <p className="text-xs text-slate-400">No line items linked to this visit.</p>
            )}
            {records.map(r => (
              <div key={r.id} className="bg-slate-50 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-medium text-slate-800">{r.title}</p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`${CAT_COLORS[r.category] || 'badge-slate'} capitalize`}>
                      {r.category?.replace(/_/g, ' ')}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/vehicles/${vehicleId}/service/${r.id}/edit`) }}
                      className="text-slate-400 hover:text-primary-600 p-0.5"
                      title="Edit service record"
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                </div>
                <PendingLinkBadges links={r.pending_work_links} vehicleId={vehicleId} />
                {r.description && (
                  <p className="text-xs text-slate-600 mb-1 leading-relaxed">{r.description}</p>
                )}
                <div className="flex gap-3 text-xs text-slate-500">
                  {r.labor_cost != null && <span>Labor: ${Number(r.labor_cost).toLocaleString()}</span>}
                  {r.parts_cost != null && <span>Parts: ${Number(r.parts_cost).toLocaleString()}</span>}
                  {r.total_cost != null && (
                    <span className="font-medium text-slate-700">Total: ${Number(r.total_cost).toLocaleString()}</span>
                  )}
                </div>
                <PartsTable parts={r.parts} />
              </div>
            ))}
            {visit.notes && (
              <p className="text-xs text-slate-500 italic pt-1">{visit.notes}</p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {years.map(year => (
        <div key={year}>
          <h3 className="card-header">{year}</h3>
          <div className="space-y-3">
            {byYear[year].map(visit => <VisitCard key={visit.id} visit={visit} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function PendingWorkTab({ vehicleId }) {
  const [showClosed, setShowClosed] = useStoredState('pending_show_completed', false)
  const { data, isLoading } = useVehiclePendingWork(vehicleId, { includeClosed: showClosed })
  const { data: people = {} } = useProfiles()
  const [sheet, setSheet] = useState(null)   // { action, item }

  const openCount = (data || []).filter(i => !CLOSED.includes(i.status)).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
          Show completed
        </label>
        <Link
          to={`/vehicles/${vehicleId}/add-pending`}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3"
        >
          <Plus size={13} /> Add Item
        </Link>
      </div>

      {isLoading && <Loading />}
      {!isLoading && !data?.length && (
        <Empty message={showClosed ? 'No pending work recorded.' : 'No open pending work items.'} />
      )}
      {!isLoading && showClosed && data?.length > 0 && openCount === 0 && (
        <p className="text-xs text-slate-400 italic">Nothing open — showing completed items.</p>
      )}

      {(data || []).map(item => (
        <PendingCard key={item.id} item={item} people={people}
          onAction={(action, it) => setSheet({ action, item: it })} />
      ))}

      {sheet && <PendingActionSheet {...sheet} onClose={() => setSheet(null)} />}
    </div>
  )
}

const MAINT_FILTERS = [
  { key: 'all',         label: 'All' },
  { key: 'oil',         label: 'Oil' },
  { key: 'tires',       label: 'Tires' },
  { key: 'brakes',      label: 'Brakes' },
  { key: 'inspection',  label: 'Inspection' },
  { key: 'registration',label: 'Registration' },
  { key: 'fluids',      label: 'Fluids' },
  { key: 'electrical',  label: 'Electrical' },
]

function matchesFilter(item, filter) {
  if (filter === 'all') return true
  const t = (item.service_item || '').toLowerCase()
  const n = (item.notes || '').toLowerCase()
  const both = t + ' ' + n
  if (filter === 'oil')          return both.includes('oil')
  if (filter === 'tires')        return both.includes('tire') || both.includes('rotation')
  if (filter === 'brakes')       return both.includes('brake') || both.includes('rotor') || both.includes('pad')
  if (filter === 'inspection')   return both.includes('inspect') || both.includes('safety') || both.includes('emissions')
  if (filter === 'registration') return both.includes('registr')
  if (filter === 'fluids')       return both.includes('fluid') || both.includes('coolant') || both.includes('transmission') || both.includes('transfer case') || both.includes('differential')
  if (filter === 'electrical')   return both.includes('battery') || both.includes('electric')
  return true
}

function SortHeader({ label, col, sortCol, sortDir, onSort }) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      className="cursor-pointer select-none hover:bg-slate-100 transition-colors"
      title={`Sort by ${label}`}
    >
      <span className="flex items-center gap-1">
        {label}
        <span className="text-slate-300">
          {active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
        </span>
      </span>
    </th>
  )
}

function MaintenanceTab({ vehicleId }) {
  const { data, isLoading } = useMaintenance(vehicleId)
  const navigate = useNavigate()
  const [filter,  setFilter]  = useState('all')
  const [sortCol, setSortCol] = useState('priority')
  const [sortDir, setSortDir] = useState('asc')

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const today      = new Date()
  const soonCutoff = addDays(today, 60)

  function dueStatus(row) {
    const d = row.next_due_date ? parseISO(row.next_due_date) : null
    if (!d) return 'unknown'
    if (isBefore(d, today))      return 'overdue'
    if (isBefore(d, soonCutoff)) return 'due_soon'
    return 'ok'
  }

  // Compute next due mileage from last done + interval (view may not expose it directly)
  function nextDueMileage(row) {
    if (!row.interval_miles) return null
    const base = row.last_done_mileage ?? null
    if (base === null) return null
    return (base + row.interval_miles).toLocaleString()
  }

  const confColors = {
    confirmed: 'badge-green', estimated: 'badge-blue',
    assumed: 'badge-amber',   unknown:   'badge-red',
  }
  const prioColors = {
    critical: 'badge-red', high: 'badge-amber', medium: 'badge-slate', low: 'badge-slate',
  }
  const statusColors = {
    overdue:  'badge-red',   due_soon: 'badge-amber',
    ok:       'badge-green', unknown:  'badge-slate',
  }
  const dueColors = {
    overdue:  'text-red-600 font-semibold',
    due_soon: 'text-amber-600 font-medium',
    ok:       'text-green-700',
    unknown:  'text-slate-400',
  }

  const PRIO_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

  function sortedFiltered() {
    const base = (data || []).filter(r => matchesFilter(r, filter))
    return [...base].sort((a, b) => {
      let cmp = 0
      if (sortCol === 'service_item') {
        cmp = (a.service_item || '').localeCompare(b.service_item || '')
      } else if (sortCol === 'category') {
        cmp = (a.category || '~').localeCompare(b.category || '~')
          || (a.service_item || '').localeCompare(b.service_item || '')
      } else if (sortCol === 'next_due_date') {
        cmp = (a.next_due_date || '9999').localeCompare(b.next_due_date || '9999')
      } else if (sortCol === 'last_done_date') {
        cmp = (a.last_done_date || '').localeCompare(b.last_done_date || '')
      } else { // priority (default)
        cmp = (PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  const filtered = sortedFiltered()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {MAINT_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filter === f.key
                  ? 'bg-primary-700 text-white border-primary-700'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-primary-400'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <Link to={`/vehicles/${vehicleId}/add-maintenance`}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3">
          <Plus size={13} /> Add Item
        </Link>
      </div>

      {isLoading && <Loading />}
      {!isLoading && !data?.length && <Empty message="No maintenance schedule set up yet." />}
      {!isLoading && data?.length > 0 && filtered.length === 0 && <Empty message="No items match this filter." />}

      {!!filtered?.length && (
        <div className="overflow-x-auto -mx-4">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <SortHeader label="Item"          col="service_item"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Category"      col="category"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th>Interval</th>
                <SortHeader label="Last Done"     col="last_done_date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th>Last Mi.</th>
                <SortHeader label="Due Date"      col="next_due_date"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th>Due Mileage</th>
                <th>Status</th>
                <th>Conf.</th>
                <SortHeader label="Pri."          col="priority"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                const status   = dueStatus(row)
                const dueMi    = nextDueMileage(row)
                return (
                  <tr key={row.id}>
                    <td className="font-medium text-slate-800">{row.service_item}</td>
                    <td className="text-xs text-slate-500 whitespace-nowrap">
                      {row.category ? enumLabel(row.category) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="text-slate-500 text-xs">
                      {row.interval_months ? `${row.interval_months} mo` : ''}
                      {row.interval_months && row.interval_miles ? ' / ' : ''}
                      {row.interval_miles ? `${row.interval_miles.toLocaleString()} mi` : ''}
                    </td>
                    <td className="text-slate-600 text-xs">
                      {row.last_done_date
                        ? format(parseISO(row.last_done_date), 'MMM yyyy')
                        : row.baseline_date
                        ? <span className="italic text-slate-400">{format(parseISO(row.baseline_date), 'MMM yyyy')} *</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </td>
                    <td className="text-xs text-slate-500">
                      {row.last_done_mileage
                        ? `${Number(row.last_done_mileage).toLocaleString()}`
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td className={`text-xs ${dueColors[status]}`}>
                      {row.next_due_date
                        ? format(parseISO(row.next_due_date), 'MMM yyyy')
                        : <span className="text-slate-400">—</span>
                      }
                    </td>
                    <td className={`text-xs ${dueMi ? dueColors[status] : ''}`}>
                      {dueMi ? `${dueMi} mi` : <span className="text-slate-400">—</span>}
                    </td>
                    <td><span className={statusColors[status] || 'badge-slate'} style={{fontSize:'10px'}}>{status.replace('_',' ')}</span></td>
                    <td><span className={confColors[row.knowledge_status] || 'badge-slate'} style={{fontSize:'10px'}}>{row.knowledge_status}</span></td>
                    <td><span className={prioColors[row.priority] || 'badge-slate'} style={{fontSize:'10px'}}>{row.priority}</span></td>
                    <td>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => navigate(`/vehicles/${vehicleId}/add-maintenance?edit=${row.id}`)}
                          className="text-slate-400 hover:text-primary-600 p-1"
                          title="Edit"
                        >
                          <Pencil size={12} />
                        </button>
                        {row.last_done_service_record_id && (
                          <button
                            type="button"
                            onClick={() => navigate(`/vehicles/${vehicleId}/service/${row.last_done_service_record_id}/edit`)}
                            className="text-primary-400 hover:text-primary-700 p-1"
                            title="View linked service record"
                          >
                            <Link2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-xs text-slate-400 px-4 py-2">* Baseline estimate — not confirmed from service record</p>
        </div>
      )}
    </div>
  )
}

function ModsTab({ vehicleId }) {
  const { data, isLoading } = useMods(vehicleId)
  const navigate = useNavigate()

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link to={`/vehicles/${vehicleId}/add-mod`}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3">
          <Plus size={13} /> Add Mod
        </Link>
      </div>
      {isLoading && <Loading />}
      {!isLoading && !data?.length && <Empty message="No modifications recorded yet." />}
      {(data || []).map(mod => (
        <div key={mod.id} className="card">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="font-semibold text-slate-800 text-sm">{mod.description}</p>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="badge-blue capitalize">{mod.category?.replace(/_/g, ' ')}</span>
              <button onClick={() => navigate(`/vehicles/${vehicleId}/add-mod?edit=${mod.id}`)}
                className="text-slate-400 hover:text-primary-600 p-0.5"><Pencil size={12} /></button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-500 mt-1">
            {mod.manufacturer && <span>{mod.manufacturer}</span>}
            {mod.part_number && <span className="font-mono">P/N {mod.part_number}</span>}
            {mod.vendor && <span>via {mod.vendor}</span>}
            {mod.order_number && <span>Order #{mod.order_number}</span>}
            {mod.mod_date && <span>{format(parseISO(mod.mod_date), 'MMM d, yyyy')}</span>}
            {mod.install_type && <span className="capitalize">{mod.install_type}</span>}
            {mod.cost && <span className="font-medium text-slate-700">${Number(mod.cost).toLocaleString()}</span>}
          </div>
          {mod.notes && <p className="text-xs text-slate-500 mt-2 italic">{mod.notes}</p>}
        </div>
      ))}
    </div>
  )
}

function NotesTab({ vehicleId }) {
  const { data, isLoading } = useNotes(vehicleId)
  const navigate = useNavigate()
  const catColors = {
    warning: 'badge-red', observation: 'badge-slate', tip: 'badge-green',
    history: 'badge-blue', quirk: 'badge-amber', other: 'badge-slate',
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link to={`/vehicles/${vehicleId}/add-note`}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3">
          <Plus size={13} /> Add Note
        </Link>
      </div>
      {isLoading && <Loading />}
      {!isLoading && !data?.length && <Empty message="No notes yet." />}
      {(data || []).map(note => (
        <div key={note.id} className={`card ${note.is_pinned ? 'border-l-4 border-l-amber-400' : ''}`}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className={`${catColors[note.category] || 'badge-slate'} capitalize`}>{note.category}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">
                {note.note_date ? format(parseISO(note.note_date), 'MMM d, yyyy') : ''}
                {note.created_by ? ` · ${note.created_by}` : ''}
              </span>
              <button onClick={() => navigate(`/vehicles/${vehicleId}/add-note?edit=${note.id}`)}
                className="text-slate-400 hover:text-primary-600 p-0.5"><Pencil size={12} /></button>
            </div>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{note.note_text}</p>
          {note.conversation_id && (
            <Link to={`/mechanic/${note.conversation_id}`}
              className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline mt-1.5">
              <MessagesSquare size={11} /> From a mechanic chat
            </Link>
          )}
        </div>
      ))}
    </div>
  )
}

function SpecsTab({ vehicleId }) {
  const { data, isLoading } = useSpecs(vehicleId)
  const navigate = useNavigate()

  const grouped = (data || []).reduce((acc, spec) => {
    if (!acc[spec.spec_category]) acc[spec.spec_category] = []
    acc[spec.spec_category].push(spec)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Link to={`/tools/tires?vehicle=${vehicleId}`}
          className="inline-flex items-center gap-1.5 btn-secondary text-xs py-1.5 px-3">
          <CircleDot size={13} /> Compare tire sizes
        </Link>
        <Link to={`/vehicles/${vehicleId}/add-spec`}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3">
          <Plus size={13} /> Add Spec
        </Link>
      </div>
      {isLoading && <Loading />}
      {!isLoading && !data?.length && <Empty message="No specs recorded yet." />}
      {Object.entries(grouped).map(([category, specs]) => (
        <div key={category} className="card">
          <h3 className="card-header">{category}</h3>
          <table className="data-table">
            <tbody>
              {specs.map(spec => (
                <tr key={spec.id}>
                  <td className="text-slate-600 w-1/2">{spec.spec_name}</td>
                  <td className="font-medium text-slate-800">
                    {spec.spec_value}{spec.units ? ` ${spec.units}` : ''}
                    <SpecTrust spec={spec} vehicleId={vehicleId} />
                  </td>
                  <td className="w-8">
                    <button onClick={() => navigate(`/vehicles/${vehicleId}/add-spec?edit=${spec.id}`)}
                      className="text-slate-400 hover:text-primary-600 p-1"><Pencil size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

/** Saved job guides (item 29, phase 1b): written by the mechanic, checked off on the phone */
function GuidesTab({ vehicleId }) {
  const { data, isLoading } = useGuides(vehicleId)
  const navigate = useNavigate()
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button"
          onClick={() => askMechanic(navigate, { vehicleId, intent: 'guide', prompt: 'Make a guide for: ' })}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3">
          <BookOpen size={13} /> Make a guide
        </button>
      </div>
      {isLoading && <Loading />}
      {!isLoading && !data?.length && (
        <Empty message="No guides yet. Ask the mechanic to make one for a job you'll do yourself, like an oil change or a brake job." />
      )}
      {(data || []).map(g => <GuideListItem key={g.id} guide={g} />)}
    </div>
  )
}

/**
 * Item 9.7: this vehicle's documents. Manuals and references first, including
 * the shared and General ones that cover it (what the mechanic can open), then
 * its receipts and records, newest first.
 */
function DocumentsTab({ vehicleId }) {
  const { data = [], isLoading, error } = useVehicleDocuments(vehicleId)
  const label = d => (d.description || d.filename || '').toLowerCase()
  const refs    = data.filter(isReference).sort((a, b) => label(a).localeCompare(label(b)))
  const records = data.filter(d => !isReference(d))
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Link to={`/vehicles/${vehicleId}/upload-document`}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3">
          <Upload size={13} /> Upload
        </Link>
      </div>
      {isLoading && <Loading />}
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {!isLoading && !error && (
        <>
          <section>
            <h2 className="card-header mb-2">Manuals & references</h2>
            {refs.length
              ? <div className="space-y-2">{refs.map(d => <DocumentRow key={d.id} doc={d} vehicleId={vehicleId} />)}</div>
              : <Empty message="No manuals yet. Upload one as “Manual / Guide”; the mechanic can open it when you ask." />}
          </section>
          <section>
            <h2 className="card-header mb-2">Receipts & records</h2>
            {records.length
              ? <div className="space-y-2">{records.map(d => <DocumentRow key={d.id} doc={d} vehicleId={vehicleId} />)}</div>
              : <Empty message="No receipts or records yet." />}
          </section>
        </>
      )}
    </div>
  )
}

/**
 * Where a spec came from and whether anyone checked it (item 29, decision 2b).
 * Specs entered by the family (source empty) show nothing.
 */
function SpecTrust({ spec, vehicleId }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [choosing, setChoosing] = useState(false)
  const verify = useMutation({
    mutationFn: async verification => {
      const { error } = await supabase.from('known_specs')
        .update({ verification, verified_at: new Date().toISOString(), verified_by: user?.id })
        .eq('id', spec.id)
      if (error) throw error
    },
    onSuccess: () => { setChoosing(false); qc.invalidateQueries({ queryKey: ['known_specs', vehicleId] }) },
  })
  if (!spec.source || spec.source === 'family') return null

  const ref = spec.source_ref
  const from = (
    <span className="text-slate-500">
      from {SPEC_SOURCE_LABEL[spec.source] ?? spec.source}
      {ref && (/^https?:\/\//.test(ref)
        ? <> · <a href={ref} target="_blank" rel="noopener noreferrer" className="underline">{hostname(ref)}</a></>
        : <> · {ref}</>)}
    </span>
  )
  return (
    <div className="mt-1 text-xs font-normal space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {isUnverified(spec)
          ? <span className="badge-amber">unverified</span>
          : <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 size={11} />{VERIFICATION_LABEL[spec.verification]}</span>}
        {spec.safety_critical && <span className="inline-flex items-center gap-0.5 text-red-700"><ShieldAlert size={11} /> safety-critical</span>}
        {from}
        {spec.conversation_id && (
          <Link to={`/mechanic/${spec.conversation_id}`} className="text-primary-700 hover:underline">chat</Link>
        )}
      </div>
      {isUnverified(spec) && !choosing && (
        <button type="button" onClick={() => setChoosing(true)}
          className="text-primary-700 underline decoration-primary-500/40 hover:text-primary-900">Mark verified…</button>
      )}
      {choosing && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(VERIFICATION_LABEL).map(([k, label]) => (
            <button key={k} type="button" disabled={verify.isPending} onClick={() => verify.mutate(k)}
              className="btn-secondary text-xs py-1 px-2">{label}</button>
          ))}
          <button type="button" onClick={() => setChoosing(false)} className="text-slate-500 px-1">Cancel</button>
        </div>
      )}
      {verify.isError && <p className="text-red-600">{verify.error.message}</p>}
    </div>
  )
}

function DiagnosticTab({ vehicleId }) {
  const { data, isLoading } = useDiagnosticCodes(vehicleId)
  const navigate = useNavigate()

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Link to={`/vehicles/${vehicleId}/add-diagnostic`}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3">
          <Plus size={13} /> Add Code
        </Link>
      </div>
      {isLoading && <Loading />}
      {!isLoading && !data?.length && <Empty message="No diagnostic codes recorded." />}
      {!!data?.length && (
        <div className="overflow-x-auto -mx-4">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Pulled</th>
                <th>Cleared</th>
                <th>Resolution</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map(code => (
                <tr key={code.id}>
                  <td><span className="font-mono font-semibold text-slate-800">{code.code}</span></td>
                  <td className="text-slate-600">{code.description || '—'}</td>
                  <td>{code.pulled_date ? format(parseISO(code.pulled_date), 'MMM d, yyyy') : '—'}</td>
                  <td>{code.cleared_date ? format(parseISO(code.cleared_date), 'MMM d, yyyy') : <span className="text-amber-600">Open</span>}</td>
                  <td className="text-slate-500 text-xs">
                    {code.resolution || '—'}
                    <SourceDocLink documentId={code.document_id} label="Source" className="block mt-0.5" />
                  </td>
                  <td className="whitespace-nowrap">
                    <button onClick={() => askMechanic(navigate, {
                      vehicleId,
                      prompt: `What could be causing ${code.code}${code.description ? ` (${code.description})` : ''} on this vehicle, and how should I track it down?`,
                      entry: { kind: 'trouble code', id: code.id, label: code.code },
                    })}
                      title="Ask the mechanic about this code"
                      className="text-slate-400 hover:text-primary-600 p-1"><MessagesSquare size={12} /></button>
                    <button onClick={() => navigate(`/vehicles/${vehicleId}/add-diagnostic?edit=${code.id}`)}
                      className="text-slate-400 hover:text-primary-600 p-1"><Pencil size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RegistrationsTab({ vehicleId }) {
  const { data, isLoading } = useRegistrations(vehicleId)
  const navigate = useNavigate()

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link to={`/vehicles/${vehicleId}/add-registration`}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3">
          <Plus size={13} /> Add Registration
        </Link>
      </div>
      {isLoading && <Loading />}
      {!isLoading && !data?.length && <Empty message="No registration records yet." />}
      {(data || []).map(reg => (
        <div key={reg.id} className="card">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <LicensePlate plate={reg.plate} state={reg.state || 'VA'} size="sm"
                  imageUrl={plateImageUrl(reg.plate_styles?.image_path)} styleName={reg.plate_styles?.name} />
                <div>
                  {reg.is_current && <span className="badge-green">Current</span>}
                  {reg.plate_styles?.name && <p className="text-xs text-slate-500 mt-0.5">{reg.plate_styles.name}</p>}
                </div>
              </div>
              <div className="flex gap-4 text-xs text-slate-500 mt-1">
                {reg.registration_date && <span>Registered: {format(parseISO(reg.registration_date), 'MMM d, yyyy')}</span>}
                {reg.expiry_date && (
                  <span className={new Date(reg.expiry_date) < new Date() ? 'text-red-600 font-medium' : ''}>
                    Expires: {format(parseISO(reg.expiry_date), 'MMM d, yyyy')}
                    {new Date(reg.expiry_date) < new Date() ? ' ⚠️ EXPIRED' : ''}
                  </span>
                )}
              </div>
              {reg.notes && <p className="text-xs text-slate-500 mt-1 italic">{reg.notes}</p>}
            </div>
            <button onClick={() => navigate(`/vehicles/${vehicleId}/add-registration?edit=${reg.id}`)}
              className="text-slate-400 hover:text-primary-600 p-1"><Pencil size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Inspections ----

const useInspections = id => useQuery({
  queryKey: ['inspections', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('inspection_status')
      .select('*')
      .eq('vehicle_id', id)
      .order('inspection_type')
    if (error) throw error
    return data
  },
  enabled: !!id,
})

const useInspectionHistory = inspectionId => useQuery({
  queryKey: ['inspection_history', inspectionId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('inspection_fulfillments')
      .select('*')
      .eq('inspection_id', inspectionId)
      .order('inspection_date', { ascending: false })
    if (error) throw error
    return data
  },
  enabled: !!inspectionId,
})

function InspectionRow({ row }) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const { data: history } = useInspectionHistory(expanded ? row.id : null)

  const status = row.expiry_status || 'unknown'
  const statusConfig = {
    current:  { label: 'Current',  badge: 'badge-green',  Icon: ShieldCheck,    text: 'text-green-700' },
    due_soon: { label: 'Due Soon', badge: 'badge-amber',  Icon: Clock,          text: 'text-amber-700' },
    expired:  { label: 'Expired',  badge: 'badge-red',    Icon: AlertTriangle,  text: 'text-red-700'   },
    failed:   { label: 'Failed',   badge: 'badge-purple', Icon: ShieldX,        text: 'text-purple-700' },
    unknown:  { label: 'Unknown',  badge: 'badge-slate',  Icon: Clock,          text: 'text-slate-500' },
  }[status] ?? { label: status, badge: 'badge-slate', Icon: Clock, text: 'text-slate-500' }
  const { data: repairs = [] } = useInspectionRepairItems(status === 'failed' ? row.fulfillment_id : null)

  const { Icon } = statusConfig

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Icon size={18} className={`mt-0.5 flex-shrink-0 ${statusConfig.text}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-800 capitalize">
                {row.inspection_type === 'safety' ? 'Safety Inspection' : 'Emissions Inspection'}
              </span>
              <span className={statusConfig.badge}>{statusConfig.label}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-slate-500">
              {row.inspection_date && (
                <span>Last: <span className="text-slate-700">{format(parseISO(row.inspection_date), 'MMM d, yyyy')}</span></span>
              )}
              {row.next_due_date && (
                <span className={
                  row.expiry_status === 'failed'   ? (row.retest_overdue ? 'text-red-600 font-medium' : 'text-purple-700 font-medium')
                  : row.expiry_status === 'expired'  ? 'text-red-600 font-medium'
                  : row.expiry_status === 'due_soon' ? 'text-amber-600 font-medium' : ''}>
                  {row.expiry_status === 'failed'
                    ? (row.retest_overdue ? 'Re-test overdue since: ' : 'Re-test by: ')
                    : row.expiry_status === 'expired' ? 'Expired: ' : 'Next due: '}
                  <span className="font-medium">{format(parseISO(row.next_due_date), 'MMM d, yyyy')}</span>
                </span>
              )}
              {row.report_number && <span>Sticker: <span className="text-slate-700">{row.report_number}</span></span>}
              {row.result && <span>Result: <span className="text-slate-700 capitalize">{row.result}</span></span>}
              {row.mileage_at_inspection && <span>Mileage: <span className="text-slate-700">{Number(row.mileage_at_inspection).toLocaleString()}</span></span>}
              <SourceDocLink documentId={row.document_id} label="Report" />
            </div>
            {repairs.map(p => (
              <Link key={p.id} to={`/vehicles/${row.vehicle_id}/add-pending?edit=${p.id}`}
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-purple-700 hover:text-purple-900 underline decoration-purple-300">
                Repairs: {p.title} · {p.status.replace('_', ' ')}
              </Link>
            ))}
            {status === 'failed' && (
              <button type="button"
                onClick={() => askMechanic(navigate, {
                  vehicleId: row.vehicle_id,
                  prompt: `This vehicle failed its ${row.inspection_type} inspection` +
                    `${repairs.length ? ` (repairs needed: ${repairs.map(p => p.title).join('; ')})` : ''}.` +
                    ' What will it take to pass the re-test, and what can I do myself?',
                  entry: { kind: 'failed inspection', id: row.fulfillment_id, label: `${row.inspection_type} inspection` },
                })}
                className="mt-1.5 flex items-center gap-1 text-xs text-primary-700 hover:text-primary-900 underline decoration-primary-500/40">
                <MessagesSquare size={12} /> Ask the mechanic about the re-test
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => navigate(`/vehicles/${row.vehicle_id}/add-inspection?edit=${row.fulfillment_id}`)}
            className="text-slate-400 hover:text-primary-600 p-1"
            title="Edit latest inspection"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-slate-400 hover:text-primary-600 p-1"
            title={expanded ? 'Hide history' : 'Show history'}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* History */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-500 mb-2">Prior inspections</p>
          {!history?.length && <p className="text-xs text-slate-400">No prior records.</p>}
          {(history || []).map((h, i) => (
            i === 0 ? null : // skip the most recent (already shown above)
            <div key={h.id} className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600 py-1 border-b border-slate-50 last:border-0">
              <span className="font-medium">{format(parseISO(h.inspection_date), 'MMM d, yyyy')}</span>
              {h.expiry_date && <span>Exp: {format(parseISO(h.expiry_date), 'MMM d, yyyy')}</span>}
              {h.result && <span className="capitalize">{h.result}</span>}
              {h.report_number && <span>#{h.report_number}</span>}
              {h.mileage_at_inspection && <span>{Number(h.mileage_at_inspection).toLocaleString()} mi</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InspectionsTab({ vehicleId }) {
  const { data, isLoading } = useInspections(vehicleId)
  const navigate = useNavigate()

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => navigate(`/vehicles/${vehicleId}/add-inspection`)}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3"
        >
          <Plus size={13} /> Log Inspection
        </button>
      </div>
      {isLoading && <Loading />}
      {!isLoading && !data?.length && <Empty message="No inspection records for this vehicle." />}
      {(data || []).map(row => <InspectionRow key={row.id} row={row} />)}
    </div>
  )
}

function Loading() {
  return <p className="text-slate-400 text-sm animate-pulse py-4">Loading…</p>
}

function Empty({ message }) {
  return <p className="text-slate-400 text-sm text-center py-8">{message}</p>
}

// ---- Main VehicleDetail ----

const TABS = [
  { id: 'service',      label: 'Service History' },
  { id: 'visits',       label: 'Visits' },
  { id: 'pending',      label: 'Pending Work' },
  { id: 'guides',       label: 'Guides' },
  { id: 'documents',    label: 'Documents' },
  { id: 'maintenance',  label: 'Maintenance' },
  { id: 'inspections',  label: 'Inspections' },
  { id: 'mods',         label: 'Modifications' },
  { id: 'notes',        label: 'Notes' },
  { id: 'specs',        label: 'Specs' },
  { id: 'diagnostic',   label: 'Diagnostics' },
  { id: 'registrations',label: 'Registration' },
]

// ---- Header status chips (item 27) ----

const INSP_CHIP = {
  current:  { badge: 'badge-green',  text: 'current' },
  due_soon: { badge: 'badge-amber',  text: 'due soon' },
  expired:  { badge: 'badge-red',    text: 'expired' },
  failed:   { badge: 'badge-purple', text: 'failed' },
  unknown:  { badge: 'badge-slate',  text: 'no record' },
}

function useRegistrationTodo(vehicleId) {
  return useQuery({
    queryKey: ['pending_work', 'registration_todo', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_work').select('id, title')
        .eq('vehicle_id', vehicleId).ilike('title', '%regist%')
        .not('status', 'in', '(completed,cancelled)').limit(1)
      if (error) throw error
      return data[0] ?? null
    },
    enabled: !!vehicleId,
  })
}

function HeaderPlate({ vehicle }) {
  const { data: reg } = useRegistrationStatus(vehicle.id)
  return (
    <Link to={`/vehicles/${vehicle.id}?tab=registrations`} title="Registration & plate style">
      <LicensePlate plate={reg?.plate || vehicle.current_plate} state={reg?.state || 'VA'}
        imageUrl={plateImageUrl(reg?.plate_style_image_path)} styleName={reg?.plate_style_name} size="sm" />
    </Link>
  )
}

function HeaderChips({ vehicle }) {
  const { data: reg } = useRegistrationStatus(vehicle.id)
  const { data: insp = [] } = useInspections(vehicle.id)
  const { data: regTodo } = useRegistrationTodo(vehicle.id)
  const [copied, setCopied] = useState(false)

  const regMeta = REG_STATUS_META[reg?.registration_status ?? 'unknown']
  const regText = reg?.expiry_date
    ? `${regMeta.label} · exp ${format(parseISO(reg.expiry_date), 'M/d/yy')}`
    : regMeta.label
  const regLink = regTodo && reg?.registration_status !== 'current'
    ? `/vehicles/${vehicle.id}/add-pending?edit=${regTodo.id}`
    : `/vehicles/${vehicle.id}?tab=registrations`

  async function copyVin() {
    try { await navigator.clipboard.writeText(vehicle.vin); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  return (
    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
      {vehicle.vin && (
        <button type="button" onClick={copyVin} title="Copy VIN"
          className="badge-slate font-mono hover:bg-white transition-colors">
          {copied ? 'VIN copied ✓' : `VIN ${vehicle.vin}`}
        </button>
      )}
      <Link to={regLink} className={`${regMeta.badge} hover:opacity-80`}
        title={regTodo && reg?.registration_status !== 'current' ? `To-do: ${regTodo.title}` : 'Registrations'}>
        {regText}
      </Link>
      {['safety', 'emissions'].map(type => {
        const row = insp.find(r => r.inspection_type === type)
        const st  = row?.expiry_status ?? 'unknown'
        const cfg = INSP_CHIP[st] ?? INSP_CHIP.unknown
        return (
          <Link key={type} to={`/vehicles/${vehicle.id}?tab=inspections`} className={`${cfg.badge} hover:opacity-80`}>
            {type === 'safety' ? 'Safety' : 'Emissions'}: {cfg.text}
            {row?.next_due_date && st !== 'unknown' ? ` · ${format(parseISO(row.next_due_date), 'M/d/yy')}` : ''}
          </Link>
        )
      })}
    </div>
  )
}

export default function VehicleDetail() {
  const { id }             = useParams()
  const navigate           = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Allow ?tab=pending etc. to deep-link into a specific tab
  const tabParam = searchParams.get('tab')
  const [tab, setTab] = useState(tabParam || 'service')

  function switchTab(t) {
    setTab(t)
    setSearchParams({ tab: t }, { replace: true })
  }

  const { data: vehicle, isLoading } = useVehicle(id)
  const { data: mileageData }        = useCurrentMileage(id)

  if (isLoading) {
    return (
      <div className="p-4 text-slate-400 text-sm animate-pulse">Loading vehicle…</div>
    )
  }
  if (!vehicle) {
    return <div className="p-4 text-red-500 text-sm">Vehicle not found.</div>
  }

  const statusColor = {
    active: 'badge-green', project: 'badge-blue', inactive: 'badge-slate',
  }[vehicle.status] || 'badge-slate'

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="bg-primary-900 text-white px-4 pt-4 pb-0">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white"
        >
          <ArrowLeft size={14} /> Back
        </button>

        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold leading-tight">
              {vehicle.name || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            </h1>
            <p className="text-primary-200 text-sm mt-0.5">
              {vehicle.year} {vehicle.make} {vehicle.model}
              {vehicle.trim ? ` ${vehicle.trim}` : ''}
              {vehicle.engine_size ? ` · ${vehicle.engine_size}` : ''}
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={statusColor}>{vehicle.status}</span>
              {vehicle.primary_driver && (
                <span className="text-xs text-primary-300">Driver: {vehicle.primary_driver}</span>
              )}
            </div>
            <HeaderChips vehicle={vehicle} />
          </div>

          {/* Plate + mileage */}
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {vehicle.current_plate && <HeaderPlate vehicle={vehicle} />}
          {mileageData?.current_mileage && (
            <div className="flex flex-col items-end flex-shrink-0">
              <div className="flex items-center gap-1 text-primary-200 text-xs mb-0.5">
                <Gauge size={12} /> Mileage
              </div>
              <p className="text-2xl font-bold text-white">
                {Number(mileageData.current_mileage).toLocaleString()}
              </p>
            </div>
          )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mb-3">
          <Link
            to={`/vehicles/${id}/add-visit`}
            className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white
                       font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={14} /> Log Visit
          </Link>
          <Link
            to={`/vehicles/${id}/upload-document`}
            className="inline-flex items-center gap-1.5 bg-primary-700 hover:bg-primary-600 text-white
                       font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors"
          >
            <Upload size={14} /> Upload Doc
          </Link>
          <Link
            to={`/vehicles/${id}/edit`}
            className="inline-flex items-center gap-1.5 bg-primary-800 hover:bg-primary-700 text-primary-200
                       font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors"
          >
            <Pencil size={13} /> Edit
          </Link>
          <button type="button" onClick={() => askMechanic(navigate, { vehicleId: id })}
            className="inline-flex items-center gap-1.5 bg-primary-800 hover:bg-primary-700 text-primary-200
                       font-semibold text-sm px-3 py-1.5 rounded-lg transition-colors">
            <MessagesSquare size={13} /> Ask mechanic
          </button>
        </div>

        {/* Tab bar */}
        <div className="tab-bar">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 p-4 max-w-3xl mx-auto w-full">
        {tab === 'service'       && <ServiceHistoryTab vehicleId={id} />}
        {tab === 'visits'        && <ServiceVisitsTab  vehicleId={id} />}
        {tab === 'pending'       && <PendingWorkTab    vehicleId={id} />}
        {tab === 'guides'        && <GuidesTab         vehicleId={id} />}
        {tab === 'documents'     && <DocumentsTab      vehicleId={id} />}
        {tab === 'maintenance'   && <MaintenanceTab    vehicleId={id} />}
        {tab === 'inspections'   && <InspectionsTab    vehicleId={id} />}
        {tab === 'mods'          && <ModsTab           vehicleId={id} />}
        {tab === 'notes'         && <NotesTab          vehicleId={id} />}
        {tab === 'specs'         && <SpecsTab          vehicleId={id} />}
        {tab === 'diagnostic'    && <DiagnosticTab     vehicleId={id} />}
        {tab === 'registrations' && <RegistrationsTab  vehicleId={id} />}
      </div>
    </div>
  )
}
