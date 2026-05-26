import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { format, parseISO } from 'date-fns'
import { Plus, ArrowLeft, Gauge } from 'lucide-react'

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
        *, service_visits(visit_date, work_order, invoice_number, technician, total_cost,
          shops(name, phone))
      `)
      .eq('vehicle_id', id)
      .order('service_date', { ascending: false })
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
      .from('maintenance_schedule')
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

function ServiceHistoryTab({ vehicleId }) {
  const { data, isLoading } = useServiceHistory(vehicleId)
  const catColors = {
    oil_change: 'badge-green', brakes: 'badge-amber', tires: 'badge-blue',
    diagnostic: 'badge-amber', ac_hvac: 'badge-blue', engine: 'badge-red',
    suspension: 'badge-amber', modification: 'badge-blue', fuel_system: 'badge-blue',
  }

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
            <span className={`${catColors[r.category] || 'badge-slate'} capitalize flex-shrink-0`}>
              {r.category?.replace(/_/g, ' ')}
            </span>
          </div>

          {r.description && (
            <p className="text-xs text-slate-600 mb-2 leading-relaxed">{r.description}</p>
          )}

          <div className="flex items-center gap-4 text-xs text-slate-500">
            {r.total_cost != null && (
              <span className="font-medium text-slate-700">
                ${Number(r.total_cost).toLocaleString()}
              </span>
            )}
            {r.notes && <span className="italic truncate">{r.notes}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function PendingWorkTab({ vehicleId }) {
  const { data, isLoading } = usePendingWork(vehicleId)
  const prioColors = {
    high: 'badge-red', medium: 'badge-amber', low: 'badge-slate',
    watch: 'badge-blue', conditional: 'badge-slate',
  }
  const statusColors = {
    pending: 'badge-amber', in_progress: 'badge-blue',
    watch: 'badge-blue', conditional: 'badge-slate',
  }

  if (isLoading) return <Loading />
  if (!data?.length) return <Empty message="No open pending work items." />

  return (
    <div className="space-y-3">
      {data.map(item => (
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
          <div className="flex items-center gap-4 text-xs text-slate-500">
            {item.estimated_cost && <span>Est: {item.estimated_cost}</span>}
            {item.identified_by && <span>Source: {item.identified_by}</span>}
            {item.identified_date && (
              <span>ID'd: {format(parseISO(item.identified_date), 'MMM yyyy')}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function MaintenanceTab({ vehicleId }) {
  const { data, isLoading } = useMaintenance(vehicleId)
  const statusColors = {
    confirmed: 'badge-green', estimated: 'badge-blue',
    assumed: 'badge-amber', unknown: 'badge-red',
  }
  const prioColors = {
    critical: 'badge-red', high: 'badge-amber', medium: 'badge-slate', low: 'badge-slate',
  }

  if (isLoading) return <Loading />
  if (!data?.length) return <Empty message="No maintenance schedule set up yet." />

  return (
    <div className="overflow-x-auto -mx-4">
      <table className="data-table min-w-full">
        <thead>
          <tr>
            <th>Item</th>
            <th>Interval</th>
            <th>Last Done</th>
            <th>Confidence</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr key={row.id}>
              <td className="font-medium text-slate-800">{row.service_item}</td>
              <td className="text-slate-500">
                {row.interval_months ? `${row.interval_months} mo` : ''}
                {row.interval_months && row.interval_miles ? ' / ' : ''}
                {row.interval_miles ? `${row.interval_miles.toLocaleString()} mi` : ''}
              </td>
              <td className="text-slate-600">
                {row.last_done_date
                  ? format(parseISO(row.last_done_date), 'MMM yyyy')
                  : row.baseline_date
                  ? <span className="italic text-slate-400">{format(parseISO(row.baseline_date), 'MMM yyyy')} *</span>
                  : <span className="text-slate-400">—</span>
                }
              </td>
              <td><span className={statusColors[row.knowledge_status] || 'badge-slate'}>{row.knowledge_status}</span></td>
              <td><span className={prioColors[row.priority] || 'badge-slate'}>{row.priority}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 px-4 py-2">* Baseline estimate — not confirmed from service record</p>
    </div>
  )
}

function ModsTab({ vehicleId }) {
  const { data, isLoading } = useMods(vehicleId)

  if (isLoading) return <Loading />
  if (!data?.length) return <Empty message="No modifications recorded yet." />

  return (
    <div className="space-y-3">
      {data.map(mod => (
        <div key={mod.id} className="card">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="font-semibold text-slate-800 text-sm">{mod.description}</p>
            <span className="badge-blue capitalize flex-shrink-0">
              {mod.category?.replace(/_/g, ' ')}
            </span>
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
  const catColors = {
    warning: 'badge-red', observation: 'badge-slate', tip: 'badge-green',
    history: 'badge-blue', quirk: 'badge-amber',
  }

  if (isLoading) return <Loading />
  if (!data?.length) return <Empty message="No notes yet." />

  return (
    <div className="space-y-3">
      {data.map(note => (
        <div key={note.id} className={`card ${note.is_pinned ? 'border-l-4 border-l-amber-400' : ''}`}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className={`${catColors[note.category] || 'badge-slate'} capitalize`}>{note.category}</span>
            <span className="text-xs text-slate-400">
              {note.note_date ? format(parseISO(note.note_date), 'MMM d, yyyy') : ''}
              {note.created_by ? ` · ${note.created_by}` : ''}
            </span>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{note.note_text}</p>
        </div>
      ))}
    </div>
  )
}

function SpecsTab({ vehicleId }) {
  const { data, isLoading } = useSpecs(vehicleId)

  if (isLoading) return <Loading />
  if (!data?.length) return <Empty message="No specs recorded yet." />

  // Group by category
  const grouped = (data || []).reduce((acc, spec) => {
    if (!acc[spec.spec_category]) acc[spec.spec_category] = []
    acc[spec.spec_category].push(spec)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([category, specs]) => (
        <div key={category} className="card">
          <h3 className="card-header">{category}</h3>
          <table className="data-table">
            <tbody>
              {specs.map(spec => (
                <tr key={spec.id}>
                  <td className="text-slate-600 w-1/2">{spec.spec_name}</td>
                  <td className="font-medium text-slate-800">
                    {spec.spec_value}
                    {spec.units ? ` ${spec.units}` : ''}
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

  if (isLoading) return <Loading />
  if (!data?.length) return <Empty message="No diagnostic codes recorded." />

  return (
    <div className="overflow-x-auto -mx-4">
      <table className="data-table min-w-full">
        <thead>
          <tr>
            <th>Code</th>
            <th>Description</th>
            <th>Pulled</th>
            <th>Cleared</th>
            <th>Resolution</th>
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
            </tr>
          ))}
        </tbody>
      </table>
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
  { id: 'pending',     label: 'Pending Work' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'mods',        label: 'Modifications' },
  { id: 'notes',       label: 'Notes' },
  { id: 'specs',       label: 'Specs' },
  { id: 'diagnostic',  label: 'Diagnostics' },
]

export default function VehicleDetail() {
  const { id }       = useParams()
  const navigate     = useNavigate()
  const [tab, setTab] = useState('service')

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

        {/* Add service button */}
        <div className="mb-3">
          <Link
            to={`/vehicles/${id}/add-service`}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white
                       font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={15} /> Add Service Record
          </Link>
        </div>

        {/* Tab bar */}
        <div className="tab-bar">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 p-4 max-w-3xl mx-auto w-full">
        {tab === 'service'     && <ServiceHistoryTab vehicleId={id} />}
        {tab === 'pending'     && <PendingWorkTab    vehicleId={id} />}
        {tab === 'maintenance' && <MaintenanceTab    vehicleId={id} />}
        {tab === 'mods'        && <ModsTab           vehicleId={id} />}
        {tab === 'notes'       && <NotesTab          vehicleId={id} />}
        {tab === 'specs'       && <SpecsTab          vehicleId={id} />}
        {tab === 'diagnostic'  && <DiagnosticTab     vehicleId={id} />}
      </div>
    </div>
  )
}
