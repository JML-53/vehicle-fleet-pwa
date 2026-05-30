import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  Plus, Pencil, ChevronDown, ChevronRight,
  CheckCircle2, Circle, AlertCircle, Clock, XCircle, ThumbsUp,
  MinusCircle, ArrowDownCircle, Download
} from 'lucide-react'

function exportRoadmapJSON(items) {
  const out = {
    exported_at: new Date().toISOString(),
    count: items.length,
    items,
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'roadmap_export.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS = {
  new:              { label: 'New',           badge: 'badge-blue',   Icon: Circle },
  deferred:         { label: 'Deferred',      badge: 'badge-slate',  Icon: MinusCircle },
  not_implemented:  { label: 'Not Impl.',     badge: 'badge-red',    Icon: XCircle },
  not_tested:       { label: 'Not Tested',    badge: 'badge-slate',  Icon: Clock },
  partial:          { label: 'Partial',       badge: 'badge-amber',  Icon: AlertCircle },
  complete:         { label: 'Complete',      badge: 'badge-green',  Icon: CheckCircle2 },
  approved:         { label: 'Approved ✓',    badge: 'badge-teal',   Icon: ThumbsUp },
}

// Priority config
const PRIORITY = {
  high:   { label: 'High',   color: 'text-red-600',   dot: 'bg-red-500' },
  medium: { label: 'Med',    color: 'text-amber-600', dot: 'bg-amber-400' },
  low:    { label: 'Low',    color: 'text-slate-400', dot: 'bg-slate-300' },
}

const GROUP_META = {
  enhancement: { label: 'Enhancements',      color: 'text-primary-700' },
  bug:         { label: 'Bugs & Corrections', color: 'text-red-700' },
  question:    { label: 'Questions',          color: 'text-amber-700' },
}

const GROUP_ORDER = ['enhancement', 'bug', 'question']

// Filter chips — order per spec:
//   All | New | Deferred | Not Impl. | Not Tested | Partial | Complete | Approved | Active
const FILTERS = [
  { key: 'all',             label: 'All' },
  { key: 'new',             label: 'New' },
  { key: 'deferred',        label: 'Deferred' },
  { key: 'not_implemented', label: 'Not Impl.' },
  { key: 'not_tested',      label: 'Not Tested' },
  { key: 'partial',         label: 'Partial' },
  { key: 'complete',        label: 'Complete' },
  { key: 'approved',        label: 'Approved' },
  { key: 'active',          label: 'Active' },   // all except approved + deferred
]

// "Active" = everything that isn't approved or deferred
const ACTIVE_STATUSES = new Set(['new', 'not_implemented', 'not_tested', 'partial', 'complete'])

// ── Item row ─────────────────────────────────────────────────────────────────
function RoadmapRow({ item, isChild = false }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const s = STATUS[item.status] || STATUS.new
  const { Icon } = s
  const prio = PRIORITY[item.priority] || PRIORITY.medium

  const quickApproveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('roadmap_items')
        .update({ status: 'approved', date_completed: new Date().toISOString().split('T')[0] })
        .eq('id', item.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roadmap'] }),
  })

  const hasDetails = item.description || item.impl_notes || item.feedback

  return (
    <div className={isChild ? 'ml-6 border-l-2 border-primary-100 pl-3' : ''}>
      <div className="flex items-start gap-2 py-2.5 px-3 rounded-lg group hover:bg-slate-50">

        {/* Expand toggle */}
        <button
          onClick={() => hasDetails && setOpen(o => !o)}
          className={`mt-0.5 flex-shrink-0 text-slate-400 ${!hasDetails ? 'opacity-0 pointer-events-none' : ''}`}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Status icon */}
        <Icon size={16} className={`flex-shrink-0 mt-0.5 ${
          item.status === 'approved'        ? 'text-teal-600'   :
          item.status === 'complete'        ? 'text-green-600'  :
          item.status === 'partial'         ? 'text-amber-500'  :
          item.status === 'not_implemented' ? 'text-red-500'    :
          item.status === 'deferred'        ? 'text-slate-400'  :
          item.status === 'not_tested'      ? 'text-slate-400'  :
          'text-blue-500'
        }`} />

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            {item.item_number && (
              <span className="text-xs font-mono text-slate-400 flex-shrink-0">{item.item_number}</span>
            )}
            <span className="text-sm font-medium text-slate-800">{item.title}</span>
            <span className={`${s.badge} text-xs flex-shrink-0`}>{s.label}</span>
            {/* Priority dot */}
            {item.priority && item.priority !== 'medium' && (
              <span className={`flex items-center gap-1 text-xs flex-shrink-0 ${prio.color}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${prio.dot}`} />
                {prio.label}
              </span>
            )}
          </div>

          {/* Dates */}
          {(item.date_requested || item.date_completed) && (
            <div className="flex gap-3 mt-0.5">
              {item.date_requested && (
                <span className="text-xs text-slate-400">
                  Requested: {new Date(item.date_requested).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
              {item.date_completed && (
                <span className="text-xs text-green-600">
                  Completed: {new Date(item.date_completed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </div>
          )}

          {/* Expanded details */}
          {open && (
            <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
              {item.description && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Requirement</p>
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{item.description}</p>
                </div>
              )}
              {item.impl_notes && (
                <div className="bg-blue-50 rounded-md p-2">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-0.5">Implementation Notes</p>
                  <p className="text-xs text-blue-900 leading-relaxed whitespace-pre-wrap">{item.impl_notes}</p>
                </div>
              )}
              {item.feedback && (
                <div className="bg-amber-50 rounded-md p-2">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-0.5">Feedback</p>
                  <p className="text-xs text-amber-900 leading-relaxed whitespace-pre-wrap">{item.feedback}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions — visible on hover */}
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Add sub-task — only on top-level items */}
          {!isChild && (
            <button
              onClick={() => navigate(`/roadmap/new?group=${item.group_name}&parent=${item.id}`)}
              title="Add sub-task"
              className="text-slate-400 hover:text-primary-700 p-1 rounded flex items-center gap-0.5
                         text-xs font-medium"
            >
              <Plus size={12} />
              <span className="hidden sm:inline">Sub</span>
            </button>
          )}
          {item.status === 'complete' && (
            <button
              onClick={() => quickApproveMutation.mutate()}
              title="Approve"
              className="text-green-600 hover:text-green-800 px-2 py-1 text-xs font-medium
                         bg-green-50 hover:bg-green-100 rounded transition-colors"
            >
              Approve
            </button>
          )}
          <button
            onClick={() => navigate(`/roadmap/${item.id}/edit`)}
            className="text-slate-400 hover:text-primary-700 p-1 rounded"
            title="Edit"
          >
            <Pencil size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RoadmapPage() {
  const [filter, setFilter]   = useState('all')
  const [sortBy, setSortBy]   = useState('item_number') // default: item number
  const navigate = useNavigate()

  const { data: allItems = [], isLoading } = useQuery({
    queryKey: ['roadmap'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roadmap_items')
        .select('*')
      if (error) throw error
      return data
    },
  })

  const topLevel  = allItems.filter(i => !i.parent_id)
  const childrenOf = id => allItems.filter(i => i.parent_id === id)

  // Visibility — for 'active' filter match any active status
  const visibleIds = new Set()
  if (filter === 'all') {
    allItems.forEach(i => visibleIds.add(i.id))
  } else if (filter === 'active') {
    allItems.forEach(i => {
      if (ACTIVE_STATUSES.has(i.status)) {
        visibleIds.add(i.id)
        if (i.parent_id) visibleIds.add(i.parent_id)
      }
    })
  } else {
    allItems.forEach(i => {
      if (i.status === filter) {
        visibleIds.add(i.id)
        if (i.parent_id) visibleIds.add(i.parent_id)
      }
    })
  }

  // Natural sort for item numbers: "1" < "2" < "5" < "10" < "11" < "11.1"
  function naturalItemNum(n) {
    if (!n) return [999, 0]
    const parts = String(n).replace(/^[A-Z]-/i, '').split('.')
    return parts.map(Number)
  }
  function compareItemNumbers(a, b) {
    const pa = naturalItemNum(a.item_number)
    const pb = naturalItemNum(b.item_number)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0)
      if (diff !== 0) return diff
    }
    return 0
  }

  function sortItems(items) {
    return [...items].sort((a, b) => {
      if (sortBy === 'date_requested')
        return (a.date_requested || '').localeCompare(b.date_requested || '')
      if (sortBy === 'status')
        return a.status.localeCompare(b.status)
      if (sortBy === 'priority') {
        const order = { high: 0, medium: 1, low: 2 }
        return (order[a.priority] ?? 1) - (order[b.priority] ?? 1)
      }
      // default: item_number (natural sort)
      return compareItemNumbers(a, b)
    })
  }

  function countForGroup(group) {
    return allItems.filter(i => i.group_name === group).length
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-primary-900 text-white px-5 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">Dev Roadmap</h1>
            <p className="text-primary-300 text-sm mt-0.5">
              Feature requests, bugs, and questions — tracked as they're built
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportRoadmapJSON(allItems)}
              title="Download roadmap_export.json"
              className="flex items-center gap-1.5 bg-primary-800 hover:bg-primary-700
                         text-primary-200 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download size={14} /> Export
            </button>
            <button
              onClick={() => navigate('/roadmap/new')}
              className="flex items-center gap-1.5 bg-primary-700 hover:bg-primary-600
                         text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus size={14} /> Add Item
            </button>
          </div>
        </div>

        {/* Filter chips */}
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

      {/* Sort bar */}
      <div className="flex items-center gap-2 px-5 py-2 bg-white border-b border-slate-200 text-xs text-slate-500">
        <span className="font-medium">Sort:</span>
        {[
          { key: 'item_number',    label: 'Item #' },
          { key: 'priority',       label: 'Priority' },
          { key: 'status',         label: 'Status' },
          { key: 'date_requested', label: 'Date' },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setSortBy(s.key)}
            className={`px-2 py-0.5 rounded font-medium transition-colors ${
              sortBy === s.key
                ? 'bg-primary-100 text-primary-800'
                : 'hover:bg-slate-100 text-slate-500'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4 max-w-3xl mx-auto space-y-6 pb-10">
        {isLoading && <p className="text-slate-400 text-sm animate-pulse py-8 text-center">Loading…</p>}

        {GROUP_ORDER.map(group => {
          const groupItems = sortItems(
            topLevel.filter(i => i.group_name === group && visibleIds.has(i.id))
          )
          if (groupItems.length === 0 && filter !== 'all') return null

          const meta         = GROUP_META[group]
          const total        = countForGroup(group)
          const approvedCount = allItems.filter(i => i.group_name === group && i.status === 'approved').length
          const awaitingCount = allItems.filter(i => i.group_name === group && i.status === 'complete').length

          return (
            <div key={group}>
              <div className="flex items-center justify-between mb-2">
                <h2 className={`card-header ${meta.color}`}>{meta.label}</h2>
                <div className="flex items-center gap-2 text-xs">
                  <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                    {approvedCount}/{total} approved
                  </span>
                  {awaitingCount > 0 && (
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      {awaitingCount} awaiting review
                    </span>
                  )}
                </div>
              </div>

              <div className="card divide-y divide-slate-50">
                {groupItems.length === 0 ? (
                  <p className="text-slate-400 text-sm px-3 py-4 text-center">
                    No items match the current filter.
                  </p>
                ) : (
                  groupItems.map(item => (
                    <div key={item.id}>
                      <RoadmapRow item={item} />
                      {sortItems(childrenOf(item.id))
                        .filter(c => visibleIds.has(c.id))
                        .map(child => (
                          <RoadmapRow key={child.id} item={child} isChild />
                        ))}
                    </div>
                  ))
                )}

                <div className="px-3 py-2">
                  <button
                    onClick={() => navigate(`/roadmap/new?group=${group}`)}
                    className="text-xs text-slate-400 hover:text-primary-700 flex items-center gap-1"
                  >
                    <Plus size={12} /> Add {GROUP_META[group].label.replace(/s$/, '').replace(/ &.*/, '').toLowerCase()} item
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
