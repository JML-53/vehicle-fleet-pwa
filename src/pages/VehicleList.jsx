import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Car } from 'lucide-react'

export default function VehicleList() {
  const { data: vehicles, isLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .order('status')
        .order('year', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const statusColor = s =>
    ({ active: 'badge-green', project: 'badge-blue', inactive: 'badge-slate' }[s] || 'badge-slate')

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <h1 className="text-xl font-bold">Vehicles</h1>
        <p className="text-primary-300 text-sm mt-0.5">
          {(vehicles || []).filter(v => v.status === 'active').length} active ·{' '}
          {(vehicles || []).filter(v => v.status === 'project').length} projects
        </p>
      </div>

      <div className="p-4 max-w-2xl mx-auto">
        {isLoading ? (
          <p className="text-slate-400 text-sm animate-pulse">Loading…</p>
        ) : (
          <div className="space-y-3">
            {(vehicles || []).map(v => (
              <Link
                key={v.id}
                to={`/vehicles/${v.id}`}
                className="card flex items-center gap-4 hover:shadow-md transition-shadow"
              >
                <div className="bg-slate-100 rounded-full p-3 flex-shrink-0">
                  <Car size={22} className="text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-800">
                      {v.name || `${v.year} ${v.make} ${v.model}`}
                    </p>
                    <span className={statusColor(v.status)}>{v.status}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {v.year} {v.make} {v.model}{v.trim ? ` ${v.trim}` : ''}
                    {v.engine_size ? ` · ${v.engine_size}` : ''}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                    {v.current_plate && (
                      <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                        {v.current_plate}
                      </span>
                    )}
                    {v.vin && <span>VIN: {v.vin}</span>}
                    {v.primary_driver && <span>Driver: {v.primary_driver}</span>}
                  </div>
                </div>
                <div className="text-slate-300 text-lg">›</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
