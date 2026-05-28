import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { format, parseISO, differenceInDays } from 'date-fns'
import { AlertTriangle, CheckCircle, Clock, Car, Plus } from 'lucide-react'

// ---- Data hooks ----

function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .order('year', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

function useInspectionStatus() {
  return useQuery({
    queryKey: ['inspection_status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspection_status')
        .select('*')
        .order('days_until_expiry', { ascending: true })
      if (error) throw error
      return data
    },
  })
}

function usePendingWorkOpen() {
  return useQuery({
    queryKey: ['pending_work_open'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_work_open')
        .select('*')
        .in('priority', ['high'])
        .limit(10)
      if (error) throw error
      return data
    },
  })
}

function useRecentService() {
  return useQuery({
    queryKey: ['recent_service'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_records')
        .select(`
          id, vehicle_id, service_date, title, category, total_cost,
          vehicles(id, name, year, make, model)
        `)
        .order('service_date', { ascending: false })
        .limit(8)
      if (error) throw error
      return data
    },
  })
}

// ---- Sub-components ----

function InspectionAlert({ row }) {
  const days = row.days_until_expiry
  const isExpired  = row.expiry_status === 'expired'
  const isDueSoon  = row.expiry_status === 'due_soon'

  const colorClass = isExpired
    ? 'border-red-300 bg-red-50'
    : isDueSoon
    ? 'border-amber-300 bg-amber-50'
    : 'border-green-200 bg-green-50'

  const iconColor = isExpired ? 'text-red-500' : isDueSoon ? 'text-amber-500' : 'text-green-500'

  return (
    <Link
      to={`/vehicles/${row.vehicle_id}`}
      className={`flex items-start gap-3 p-3 rounded-lg border ${colorClass} hover:opacity-80 transition-opacity`}
    >
      <AlertTriangle size={16} className={`mt-0.5 flex-shrink-0 ${iconColor}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">
          {row.vehicle_name} — {row.inspection_type === 'safety' ? 'Safety' : 'Emissions'}
        </p>
        <p className={`text-xs mt-0.5 ${isExpired ? 'text-red-600' : isDueSoon ? 'text-amber-600' : 'text-green-600'}`}>
          {isExpired
            ? `Expired ${Math.abs(days)} days ago`
            : isDueSoon
            ? `Due in ${days} days (${row.expiry_date ? format(parseISO(row.expiry_date), 'MMM d, yyyy') : '—'})`
            : `Current — expires ${row.expiry_date ? format(parseISO(row.expiry_date), 'MMM d, yyyy') : '—'}`
          }
        </p>
      </div>
    </Link>
  )
}

function VehicleCard({ vehicle }) {
  const statusColor = {
    active:   'badge-green',
    project:  'badge-blue',
    inactive: 'badge-slate',
  }[vehicle.status] || 'badge-slate'

  return (
    <Link
      to={`/vehicles/${vehicle.id}`}
      className="card hover:shadow-md transition-shadow flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-800 text-sm leading-tight">
            {vehicle.name || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {vehicle.year} {vehicle.make} {vehicle.model}
            {vehicle.trim ? ` ${vehicle.trim}` : ''}
          </p>
        </div>
        <span className={statusColor}>{vehicle.status}</span>
      </div>

      <div className="flex items-center gap-3 text-xs text-slate-500">
        {vehicle.current_plate && (
          <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700">
            {vehicle.current_plate}
          </span>
        )}
        {vehicle.primary_driver && (
          <span className="flex items-center gap-1">
            <Car size={11} /> {vehicle.primary_driver}
          </span>
        )}
      </div>
    </Link>
  )
}

function PendingItem({ item }) {
  return (
    <Link
      to={`/vehicles/${item.vehicle_id}?tab=pending`}
      className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0
                 hover:bg-slate-50 -mx-4 px-4 transition-colors"
    >
      <span className="badge-red mt-0.5 flex-shrink-0">{item.priority}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{item.title}</p>
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          {item.vehicle_name} — {item.estimated_cost || 'Cost TBD'}
        </p>
      </div>
    </Link>
  )
}

function ServiceRow({ record }) {
  const catColors = {
    oil_change:   'badge-green',
    brakes:       'badge-amber',
    tires:        'badge-blue',
    diagnostic:   'badge-amber',
    ac_hvac:      'badge-blue',
    engine:       'badge-red',
    suspension:   'badge-amber',
    modification: 'badge-blue',
  }
  const colorClass = catColors[record.category] || 'badge-slate'
  const label      = record.category?.replace(/_/g, ' ') || 'other'

  return (
    <Link
      to={`/vehicles/${record.vehicle_id}?tab=service`}
      className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0
                 hover:bg-slate-50 -mx-4 px-4 transition-colors"
    >
      <span className={`${colorClass} mt-0.5 flex-shrink-0 capitalize`}>{label}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{record.title}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {record.vehicles?.name} ·{' '}
          {record.service_date ? format(parseISO(record.service_date), 'MMM d, yyyy') : '—'}
          {record.total_cost ? ` · $${Number(record.total_cost).toLocaleString()}` : ''}
        </p>
      </div>
    </Link>
  )
}

// ---- Main Dashboard ----

export default function Dashboard() {
  const { profile } = useAuth()
  const vehicles    = useVehicles()
  const inspections = useInspectionStatus()
  const pending     = usePendingWorkOpen()
  const recent      = useRecentService()

  const today = format(new Date(), 'EEEE, MMMM d, yyyy')

  const alertInspections = (inspections.data || []).filter(
    r => r.expiry_status === 'expired' || r.expiry_status === 'due_soon'
  )
  const allCurrent = inspections.data?.length > 0 && alertInspections.length === 0

  return (
    <div className="flex flex-col gap-0">
      {/* Page header */}
      <div className="bg-primary-900 text-white px-5 py-5">
        <p className="text-primary-300 text-xs mb-1">{today}</p>
        <h1 className="text-xl font-bold">
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'},
          {' '}{profile?.display_name?.split(' ')[0] || 'Joe'} 👋
        </h1>
        <p className="text-primary-200 text-sm mt-1">
          {(vehicles.data || []).filter(v => v.status === 'active').length} active vehicles ·{' '}
          {(vehicles.data || []).filter(v => v.status === 'project').length} projects
        </p>
      </div>

      <div className="p-4 space-y-5 max-w-3xl mx-auto w-full">

        {/* Inspection alerts */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="card-header mb-0">Inspections</h2>
            {allCurrent && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle size={13} /> All current
              </span>
            )}
          </div>

          {inspections.isLoading && (
            <p className="text-sm text-slate-400 animate-pulse">Loading…</p>
          )}

          {alertInspections.length > 0 && (
            <div className="space-y-2">
              {alertInspections.map(r => (
                <InspectionAlert key={r.id} row={r} />
              ))}
            </div>
          )}

          {allCurrent && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-green-200 bg-green-50">
              <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
              <p className="text-sm text-green-700">All inspections are current.</p>
            </div>
          )}
        </section>

        {/* Fleet grid */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="card-header mb-0">Fleet</h2>
            <Link to="/vehicles" className="text-xs text-primary-600 hover:underline">
              View all
            </Link>
          </div>

          {vehicles.isLoading ? (
            <p className="text-sm text-slate-400 animate-pulse">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(vehicles.data || []).map(v => (
                <VehicleCard key={v.id} vehicle={v} />
              ))}
            </div>
          )}
        </section>

        {/* High-priority pending */}
        {(pending.data?.length > 0) && (
          <section>
            <h2 className="card-header">High Priority Work</h2>
            <div className="card">
              {pending.data.map(item => (
                <PendingItem key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}

        {/* Recent service */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="card-header mb-0">Recent Service</h2>
          </div>
          {recent.isLoading ? (
            <p className="text-sm text-slate-400 animate-pulse">Loading…</p>
          ) : (
            <div className="card">
              {(recent.data || []).length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No service records yet.</p>
              ) : (
                (recent.data || []).map(r => <ServiceRow key={r.id} record={r} />)
              )}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
