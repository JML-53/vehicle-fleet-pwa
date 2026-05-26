import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { format, parseISO, addMonths, isBefore, addDays } from 'date-fns'

export default function MaintenanceSchedulePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['maintenance_due_soon_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_due_soon')
        .select('*')
      if (error) throw error
      return data
    },
  })

  const today      = new Date()
  const soonCutoff = addDays(today, 60)

  function classify(row) {
    const d = row.next_due_date ? parseISO(row.next_due_date) : null
    if (!d) return 'unknown'
    if (isBefore(d, today)) return 'overdue'
    if (isBefore(d, soonCutoff)) return 'due_soon'
    return 'ok'
  }

  const statusColors = {
    overdue:  'badge-red',
    due_soon: 'badge-amber',
    ok:       'badge-green',
    unknown:  'badge-slate',
  }
  const confColors = {
    confirmed: 'badge-green', estimated: 'badge-blue',
    assumed: 'badge-amber', unknown: 'badge-red',
  }

  const grouped = (data || []).reduce((acc, row) => {
    const key = row.vehicle_name
    if (!acc[key]) acc[key] = { vehicleId: row.vehicle_id, rows: [] }
    acc[key].rows.push(row)
    return acc
  }, {})

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <h1 className="text-xl font-bold">Maintenance Schedule</h1>
        <p className="text-primary-300 text-sm mt-0.5">
          All vehicles · items marked with confidence level
        </p>
      </div>

      <div className="p-4 space-y-6 max-w-3xl mx-auto">
        {isLoading && <p className="text-slate-400 text-sm animate-pulse">Loading…</p>}

        {Object.entries(grouped).map(([vehicleName, { vehicleId, rows }]) => (
          <div key={vehicleName}>
            <Link
              to={`/vehicles/${vehicleId}`}
              className="card-header hover:text-primary-700 transition-colors block mb-2"
            >
              {vehicleName} ›
            </Link>
            <div className="card overflow-x-auto -mx-0">
              <table className="data-table min-w-full">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Interval</th>
                    <th>Next Due</th>
                    <th>Status</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const status = classify(row)
                    return (
                      <tr key={row.id}>
                        <td className="font-medium text-slate-800">{row.service_item}</td>
                        <td className="text-slate-500 text-xs">
                          {row.interval_months ? `${row.interval_months} mo` : ''}
                          {row.interval_months && row.interval_miles ? ' / ' : ''}
                          {row.interval_miles ? `${row.interval_miles.toLocaleString()} mi` : ''}
                        </td>
                        <td>
                          {row.next_due_date
                            ? format(parseISO(row.next_due_date), 'MMM yyyy')
                            : <span className="text-slate-400">—</span>
                          }
                        </td>
                        <td><span className={statusColors[status]}>{status.replace('_',' ')}</span></td>
                        <td><span className={confColors[row.knowledge_status] || 'badge-slate'}>{row.knowledge_status}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
