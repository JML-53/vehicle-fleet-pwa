import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export default function PendingWorkPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['pending_work_open'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_work_open')
        .select('*')
      if (error) throw error
      return data
    },
  })

  const prioColors = {
    high: 'badge-red', medium: 'badge-amber', low: 'badge-slate',
    watch: 'badge-blue', conditional: 'badge-slate',
  }

  // Group by vehicle
  const grouped = (data || []).reduce((acc, item) => {
    const key = item.vehicle_name
    if (!acc[key]) acc[key] = { vehicleId: item.vehicle_id, items: [] }
    acc[key].items.push(item)
    return acc
  }, {})

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <h1 className="text-xl font-bold">Pending Work</h1>
        <p className="text-primary-300 text-sm mt-0.5">
          {(data || []).length} open items across all vehicles
        </p>
      </div>

      <div className="p-4 space-y-5 max-w-2xl mx-auto">
        {isLoading && <p className="text-slate-400 text-sm animate-pulse">Loading…</p>}

        {Object.entries(grouped).map(([vehicleName, { vehicleId, items }]) => (
          <div key={vehicleName}>
            <Link
              to={`/vehicles/${vehicleId}`}
              className="card-header hover:text-primary-700 transition-colors block mb-2"
            >
              {vehicleName} ›
            </Link>
            <div className="space-y-3">
              {items.map(item => (
                <div key={item.id} className="card">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-semibold text-slate-800 text-sm">{item.title}</p>
                    <span className={`${prioColors[item.priority] || 'badge-slate'} flex-shrink-0`}>
                      {item.priority}
                    </span>
                  </div>
                  {item.description && (
                    <p className="text-xs text-slate-600 leading-relaxed mb-2 line-clamp-3">
                      {item.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                    {item.estimated_cost && <span>Est: {item.estimated_cost}</span>}
                    {item.status && <span className="capitalize">{item.status.replace('_',' ')}</span>}
                    {item.identified_by && <span>Source: {item.identified_by}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {!isLoading && Object.keys(grouped).length === 0 && (
          <p className="text-center text-slate-400 text-sm py-12">
            No open pending work items.
          </p>
        )}
      </div>
    </div>
  )
}
