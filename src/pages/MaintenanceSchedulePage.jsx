import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { format, parseISO, addMonths, isBefore, addDays } from 'date-fns'
import { Pencil, Link2 } from 'lucide-react'

const FILTERS = [
  { key: 'all',         label: 'All' },
  { key: 'oil',         label: 'Oil' },
  { key: 'tires',       label: 'Tires' },
  { key: 'brakes',      label: 'Brakes' },
  { key: 'inspection',  label: 'Inspection' },
  { key: 'registration',label: 'Registration' },
  { key: 'electrical',  label: 'Electrical' },
  { key: 'other',       label: 'Other' },
]

function rowMatchesFilter(row, filter) {
  if (filter === 'all') return true
  const text = (row.service_item || '').toLowerCase()
  if (filter === 'oil')          return text.includes('oil') || text.includes('filter')
  if (filter === 'tires')        return text.includes('tire') || text.includes('rotation') || text.includes('wheel')
  if (filter === 'brakes')       return text.includes('brake') || text.includes('rotor') || text.includes('caliper') || text.includes('pad')
  if (filter === 'inspection')   return text.includes('inspect') || text.includes('emission') || text.includes('safety')
  if (filter === 'registration') return text.includes('registr') || text.includes('tag') || text.includes('dmv')
  if (filter === 'electrical')   return text.includes('batter') || text.includes('spark') || text.includes('electr') || text.includes('alternator') || text.includes('fuse')
  // 'other' = anything that didn't match the named categories
  const named = ['oil','filter','tire','rotation','wheel','brake','rotor','caliper','pad','inspect','emission','safety','registr','tag','dmv','batter','spark','electr','alternator','fuse']
  return !named.some(kw => text.includes(kw))
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
        <span className="text-slate-300 text-xs">
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  )
}

export default function MaintenanceSchedulePage() {
  const [filter,  setFilter]  = useState('all')
  const [sortCol, setSortCol] = useState('next_due_date')
  const [sortDir, setSortDir] = useState('asc')
  const navigate = useNavigate()

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

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
  const dueDateColors = {
    overdue:  'text-red-600 font-semibold',
    due_soon: 'text-amber-600 font-medium',
    ok:       'text-green-700',
    unknown:  'text-slate-400',
  }
  const confColors = {
    confirmed: 'badge-green', estimated: 'badge-blue',
    assumed: 'badge-amber', unknown: 'badge-red',
  }
  const prioColors = {
    critical: 'badge-red', high: 'badge-amber', medium: 'badge-slate', low: 'badge-slate',
  }

  function nextDueMileage(row) {
    if (!row.interval_miles) return null
    const base = row.last_done_mileage ?? null
    if (base === null) return null
    return base + row.interval_miles
  }

  const PRIO_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

  function sortRows(rows) {
    return [...rows].sort((a, b) => {
      let cmp = 0
      if (sortCol === 'service_item') {
        cmp = (a.service_item || '').localeCompare(b.service_item || '')
      } else if (sortCol === 'next_due_date') {
        cmp = (a.next_due_date || '9999').localeCompare(b.next_due_date || '9999')
      } else if (sortCol === 'last_done_date') {
        cmp = (a.last_done_date || '').localeCompare(b.last_done_date || '')
      } else if (sortCol === 'priority') {
        cmp = (PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  const filtered = (data || []).filter(row => rowMatchesFilter(row, filter))

  const grouped = filtered.reduce((acc, row) => {
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
        <div className="flex flex-wrap gap-2 mt-3">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f.key
                  ? 'bg-white text-primary-900'
                  : 'bg-primary-800 text-primary-200 hover:bg-primary-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-4 space-y-6 w-full">
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
                    <SortHeader label="Item"      col="service_item"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <th>Interval</th>
                    <SortHeader label="Last Done" col="last_done_date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <th>Last Mi.</th>
                    <SortHeader label="Due Date"  col="next_due_date"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <th>Due Mileage</th>
                    <th>Status</th>
                    <th>Conf.</th>
                    <SortHeader label="Pri." col="priority" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortRows(rows).map(row => {
                    const status  = classify(row)
                    const dueMi   = nextDueMileage(row)
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
                            ? Number(row.last_done_mileage).toLocaleString()
                            : <span className="text-slate-300">—</span>
                          }
                        </td>
                        <td className={`text-xs ${dueDateColors[status]}`}>
                          {row.next_due_date
                            ? format(parseISO(row.next_due_date), 'MMM yyyy')
                            : <span className="text-slate-400">—</span>
                          }
                        </td>
                        <td className={`text-xs ${dueMi ? dueDateColors[status] : ''}`}>
                          {dueMi
                            ? `${dueMi.toLocaleString()} mi`
                            : <span className="text-slate-400">—</span>
                          }
                        </td>
                        <td><span className={statusColors[status]}>{status.replace('_',' ')}</span></td>
                        <td><span className={confColors[row.knowledge_status] || 'badge-slate'}>{row.knowledge_status}</span></td>
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
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
