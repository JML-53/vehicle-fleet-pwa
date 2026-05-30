import { useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'

const STATUS_OPTIONS = [
  { value: 'new',             label: '[N] New' },
  { value: 'deferred',        label: '[D] Deferred' },
  { value: 'not_implemented', label: '[X] Not Implemented' },
  { value: 'not_tested',      label: '[-] Not Tested Yet' },
  { value: 'partial',         label: '[P] Partially Implemented' },
  { value: 'complete',        label: '[C] Complete (pending review)' },
  { value: 'approved',        label: '[✓] Approved by Joe' },
]

const GROUP_OPTIONS = [
  { value: 'enhancement', label: 'Enhancement' },
  { value: 'bug',         label: 'Bug / Correction' },
  { value: 'question',    label: 'Question' },
]

// Compute the next top-level item number for a given group from existing items
function nextItemNumber(allItems, group) {
  const nums = allItems
    .filter(i => i.group_name === group && !i.parent_id && i.item_number)
    .map(i => {
      // Handle prefixed numbers like "B-1", "Q-1" — strip prefix
      const n = parseInt(String(i.item_number).replace(/^[A-Z]-/i, ''), 10)
      return isNaN(n) ? 0 : n
    })
  const max = nums.length > 0 ? Math.max(...nums) : 0
  // Add group prefix for bugs and questions
  if (group === 'bug')      return `B-${max + 1}`
  if (group === 'question') return `Q-${max + 1}`
  return String(max + 1)
}

// Compute next sub-task number for a given parent item number
function nextSubNumber(allItems, parentItemNumber) {
  if (!parentItemNumber) return ''
  const base = String(parentItemNumber).replace(/^[A-Z]-/i, '')
  const subs = allItems
    .filter(i => {
      const n = String(i.item_number || '')
      return n.startsWith(base + '.') && n.split('.').length === 2
    })
    .map(i => parseInt(String(i.item_number).split('.')[1], 10))
    .filter(n => !isNaN(n))
  const max = subs.length > 0 ? Math.max(...subs) : 0
  return `${parentItemNumber}.${max + 1}`
}

export default function AddEditRoadmapItem() {
  const { itemId }         = useParams()
  const [searchParams]     = useSearchParams()
  const navigate           = useNavigate()
  const qc                 = useQueryClient()
  const isEditing          = !!itemId

  const presetGroup  = searchParams.get('group')  || 'enhancement'
  const presetParent = searchParams.get('parent') || ''

  // Fetch existing item when editing
  const { data: existing } = useQuery({
    queryKey: ['roadmap_item', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roadmap_items').select('*').eq('id', itemId).single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  // Fetch all items — used for parent picker and auto-numbering
  const { data: allItems = [] } = useQuery({
    queryKey: ['roadmap'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roadmap_items').select('*')
      if (error) throw error
      return data
    },
  })

  const parentOptions = allItems.filter(i => !i.parent_id)

  // Auto-suggest item number when group or parent changes
  const suggestNumber = useCallback((group, parentId) => {
    if (parentId) {
      const parent = allItems.find(i => i.id === parentId)
      return nextSubNumber(allItems, parent?.item_number)
    }
    return nextItemNumber(allItems, group)
  }, [allItems])

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm({
    defaultValues: {
      group_name:     presetGroup,
      status:         'new',
      priority:       'medium',
      item_number:    '',
      title:          '',
      description:    '',
      parent_id:      presetParent,
      date_requested: new Date().toISOString().split('T')[0],
      date_completed: '',
      impl_notes:     '',
      feedback:       '',
      sort_order:     0,
    },
  })

  const watchedGroup    = watch('group_name')
  const watchedParent   = watch('parent_id')
  const watchedStatus   = watch('status')
  const watchedItemNum  = watch('item_number')

  // Populate item number suggestion when group or parent changes (add mode only)
  useEffect(() => {
    if (isEditing || allItems.length === 0) return
    // Only auto-fill if the field is still empty or matches a previous suggestion
    const suggested = suggestNumber(watchedGroup, watchedParent)
    setValue('item_number', suggested)
  }, [watchedGroup, watchedParent, allItems.length]) // eslint-disable-line

  // When parent is selected, copy its group into the group field
  useEffect(() => {
    if (!watchedParent || isEditing) return
    const parent = allItems.find(i => i.id === watchedParent)
    if (parent) setValue('group_name', parent.group_name)
  }, [watchedParent]) // eslint-disable-line

  // Populate form when editing
  useEffect(() => {
    if (existing) {
      reset({
        ...existing,
        parent_id:      existing.parent_id      || '',
        date_requested: existing.date_requested  || '',
        date_completed: existing.date_completed  || '',
        priority:       existing.priority        || 'medium',
      })
    }
  }, [existing, reset])

  const mutation = useMutation({
    mutationFn: async (values) => {
      const payload = {
        ...values,
        parent_id:      values.parent_id      || null,
        date_requested: values.date_requested  || null,
        date_completed: values.date_completed  || null,
        sort_order:     Number(values.sort_order) || 0,
      }
      if (isEditing) {
        const { error } = await supabase.from('roadmap_items').update(payload).eq('id', itemId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('roadmap_items').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roadmap'] })
      // Also invalidate the single-item cache so re-opening the edit form shows fresh data
      if (itemId) qc.invalidateQueries({ queryKey: ['roadmap_item', itemId] })
      navigate(-1)  // returns to /roadmap preserving its URL params (filter + sort)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('roadmap_items').delete().eq('id', itemId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roadmap'] })
      navigate('/roadmap')
    },
  })

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back to Roadmap
        </button>
        <h1 className="text-xl font-bold">
          {isEditing ? 'Edit Roadmap Item' : 'Add Roadmap Item'}
        </h1>
      </div>

      <form
        onSubmit={handleSubmit(d => mutation.mutate(d))}
        className="p-4 space-y-4 max-w-2xl mx-auto pb-10"
      >
        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {mutation.error?.message}
          </div>
        )}

        {/* ── Item Details ── */}
        <div className="card space-y-3">
          <h2 className="card-header">Item Details</h2>

          <div>
            <label className="field-label">Title *</label>
            <input
              {...register('title', { required: 'Title is required' })}
              placeholder="Short description of the feature or bug"
              className={`field-input ${errors.title ? 'border-red-400' : ''}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Group</label>
              <select {...register('group_name')} className="field-select">
                {GROUP_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">
                Item #
                {!isEditing && (
                  <span className="ml-1 text-slate-400 font-normal text-xs">(auto-suggested)</span>
                )}
              </label>
              <input
                {...register('item_number')}
                placeholder="e.g. 5, 5.1, B-2"
                className="field-input font-mono"
              />
            </div>
          </div>

          <div>
            <label className="field-label">Parent Item (optional — makes this a sub-task)</label>
            <select {...register('parent_id')} className="field-select">
              <option value="">— Top-level item —</option>
              {parentOptions
                .filter(p => !isEditing || p.id !== itemId)
                .map(p => (
                  <option key={p.id} value={p.id}>
                    [{p.group_name.substring(0,3).toUpperCase()}]
                    {p.item_number ? ` ${p.item_number} ·` : ''} {p.title}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="field-label">Full Description / Requirement</label>
            <textarea
              {...register('description')}
              rows={4}
              placeholder="Detailed description of the requirement, bug steps, or question…"
              className="field-textarea"
            />
          </div>
        </div>

        {/* ── Joe's Review ── */}
        <div className="card space-y-3 border border-amber-200 bg-amber-50">
          <h2 className="card-header text-amber-800">Joe's Review</h2>
          <p className="text-xs text-amber-700">
            Update status, priority, and feedback after reviewing a completed item.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Status</label>
              <select {...register('status')} className="field-select">
                {STATUS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Priority</label>
              <select {...register('priority')} className="field-select">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="field-label">Date Requested</label>
              <input {...register('date_requested')} type="date" className="field-input" />
            </div>
            <div>
              <label className="field-label">Date Completed</label>
              <input {...register('date_completed')} type="date" className="field-input" />
              <p className="text-xs text-slate-400 mt-0.5">
                {watchedStatus === 'approved' ? 'Set when approving.' : 'Leave blank until done.'}
              </p>
            </div>
            <div>
              <label className="field-label">Sort Order</label>
              <input {...register('sort_order')} type="number" placeholder="10" className="field-input" />
            </div>
          </div>

          <div>
            <label className="field-label">Feedback</label>
            <textarea
              {...register('feedback')}
              rows={3}
              placeholder="Notes if marking as partial or not implemented — what's missing or wrong?"
              className="field-textarea border-amber-200 bg-white"
            />
          </div>
        </div>

        {/* ── Implementation Notes ── */}
        <div className="card space-y-3 border border-blue-200 bg-blue-50">
          <h2 className="card-header text-blue-800">Implementation Notes</h2>
          <p className="text-xs text-blue-700">
            Filled in by Claude — describes what was built, what files changed, and any caveats.
          </p>
          <textarea
            {...register('impl_notes')}
            rows={5}
            placeholder="What was changed, which files, any follow-up SQL to run, known limitations…"
            className="field-textarea border-blue-200 bg-white"
          />
        </div>

        {/* ── Actions ── */}
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Item'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            Cancel
          </button>
          {isEditing && (
            <button
              type="button"
              onClick={() => { if (window.confirm('Delete this roadmap item?')) deleteMutation.mutate() }}
              className="btn-danger"
            >
              Delete
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
