import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { format, parseISO, isBefore, addDays } from 'date-fns'
import { Plus, ArrowLeft, Gauge, Pencil, Upload } from 'lucide-react'

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
        service_visits(visit_date, work_order, invoice_number, technician, total_cost, shops(name, phone)),
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
          parts(id, part_name, part_number, manufacturer, vendor, quantity, unit_cost, total_cost))
      `)
      .eq('vehicle_id', id)
      .order('visit_date', { ascending: false })
    if (error) throw error
    return data
  },
  enabled: !!id,
})

const usePendingWork = id => useQuery({
  queryKey: ['pending_work', id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('pending_work')
      .select('*')
      .eq('vehicle_id', id)
      .not('status', 'in', '("completed","cancelled")')
      .order('status')
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
      .from('registrations').select('*').eq('vehicle_id', id)
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
                <p className="font-semibold text-slate-800 text-sm">
                  {visit.visit_date ? format(parseISO(visit.visit_date), 'MMM d, yyyy') : '—'}
                  {visit.shops?.name ? ` — ${visit.shops.name}` : ''}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {records.length} service item{records.length !== 1 ? 's' : ''}
                  {visit.work_order ? ` · WO ${visit.work_order}` : ''}
                  {visit.invoice_number ? ` · Inv ${visit.invoice_number}` : ''}
                  {visit.total_cost != null ? ` · $${Number(visit.total_cost).toLocaleString()}` : ''}
                </p>
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
  const { data, isLoading } = usePendingWork(vehicleId)
  const qc = useQueryClient()
  const navigate = useNavigate()

  const prioColors = {
    high: 'badge-red', medium: 'badge-amber', low: 'badge-slate',
    watch: 'badge-blue', conditional: 'badge-slate',
  }
  const statusColors = {
    pending: 'badge-amber', in_progress: 'badge-blue',
    deferred: 'badge-slate', watch: 'badge-blue', conditional: 'badge-slate',
  }

  const markComplete = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('pending_work').update({ status: 'completed' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending_work', vehicleId] })
      qc.invalidateQueries({ queryKey: ['pending_work_open'] })
    },
  })

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link
          to={`/vehicles/${vehicleId}/add-pending`}
          className="inline-flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3"
        >
          <Plus size={13} /> Add Item
        </Link>
      </div>

      {isLoading && <Loading />}
      {!isLoading && !data?.length && <Empty message="No open pending work items." />}

      {(data || []).map(item => (
        <div key={item.id} className="card">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="font-semibold text-slate-800 text-sm">{item.title}</p>
            <div className="flex gap-1.5 flex-shrink-0">
              <span className={prioColors[item.priority] || 'badge-slate'}>{item.priority}</span>
              <span className={statusColors[item.status] || 'badge-slate'}>{item.status?.replace('_',' ')}</span>
            </div>
          </div>
          {item.description && (
            <p className="text-xs text-slate-600 leading-relaxed mb-2">{item.description}</p>
          )}
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-4 text-xs text-slate-500">
              {item.estimated_cost && <span>Est: {item.estimated_cost}</span>}
              {item.identified_by && <span>Source: {item.identified_by}</span>}
              {item.identified_date && (
                <span>ID'd: {format(parseISO(item.identified_date), 'MMM yyyy')}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(`/vehicles/${vehicleId}/add-pending?edit=${item.id}`)}
                className="text-xs text-slate-400 hover:text-primary-600 flex items-center gap-0.5"
              >
                <Pencil size={11} /> Edit
              </button>
              {item.status !== 'completed' && (
                <button
                  onClick={() => markComplete.mutate(item.id)}
                  disabled={markComplete.isPending}
                  className="text-xs text-green-600 hover:text-green-800 font-medium"
                >
                  ✓ Done
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
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
                <th>Interval</th>
                <SortHeader label="Last Done"     col="last_done_date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th>Last Mi.</th>
                <SortHeader label="Due Date"      col="next_due_date"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th>Due Mileage</th>
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
                    <td><span className={confColors[row.knowledge_status] || 'badge-slate'} style={{fontSize:'10px'}}>{row.knowledge_status}</span></td>
                    <td><span className={prioColors[row.priority] || 'badge-slate'} style={{fontSize:'10px'}}>{row.priority}</span></td>
                    <td>
                      <button
                        onClick={() => navigate(`/vehicles/${vehicleId}/add-maintenance?edit=${row.id}`)}
                        className="text-slate-400 hover:text-primary-600 p-1"
                        title="Edit"
                      >
                        <Pencil size={12} />
                      </button>
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
      <div className="flex justify-end">
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
                  <td className="text-slate-500 text-xs">{code.resolution || '—'}</td>
                  <td>
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
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-slate-800">{reg.plate}</span>
                <span className="text-xs text-slate-500">{reg.state}</span>
                {reg.is_current && <span className="badge-green">Current</span>}
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

function Loading() {
  return <p className="text-slate-400 text-sm animate-pulse py-4">Loading…</p>
}

function Empty({ message }) {
  return <p className="text-slate-400 text-sm text-center py-8">{message}</p>
}

// ---- Main VehicleDetail ----

const TABS = [
  { id: 'service',     label: 'Service History' },
  { id: 'visits',      label: 'Visits' },
  { id: 'pending',     label: 'Pending Work' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'mods',        label: 'Modifications' },
  { id: 'notes',       label: 'Notes' },
  { id: 'specs',       label: 'Specs' },
  { id: 'diagnostic',  label: 'Diagnostics' },
  { id: 'registrations', label: 'Registration' },
]

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
              {vehicle.current_plate && (
                <span className="font-mono text-xs bg-primary-800 px-2 py-0.5 rounded text-primary-100">
                  {vehicle.current_plate}
                </span>
              )}
              {vehicle.primary_driver && (
                <span className="text-xs text-primary-300">Driver: {vehicle.primary_driver}</span>
              )}
            </div>
          </div>

          {/* Mileage */}
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
        {tab === 'maintenance'   && <MaintenanceTab    vehicleId={id} />}
        {tab === 'mods'          && <ModsTab           vehicleId={id} />}
        {tab === 'notes'         && <NotesTab          vehicleId={id} />}
        {tab === 'specs'         && <SpecsTab          vehicleId={id} />}
        {tab === 'diagnostic'    && <DiagnosticTab     vehicleId={id} />}
        {tab === 'registrations' && <RegistrationsTab  vehicleId={id} />}
      </div>
    </div>
  )
}
