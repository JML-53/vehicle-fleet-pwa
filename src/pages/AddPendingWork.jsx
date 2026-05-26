import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'

export default function AddPendingWork() {
  const { id: vehicleId } = useParams()
  const [searchParams] = useSearchParams()
  const itemId = searchParams.get('edit')   // ?edit=<uuid> for edit mode
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEditing = !!itemId

  const { data: existing } = useQuery({
    queryKey: ['pending_work_item', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_work').select('*').eq('id', itemId).single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: { status: 'pending', priority: 'medium' },
  })

  useEffect(() => {
    if (existing) reset(existing)
  }, [existing, reset])

  const mutation = useMutation({
    mutationFn: async (values) => {
      const payload = {
        ...values,
        vehicle_id: vehicleId,
        identified_date: values.identified_date || null,
      }
      if (isEditing) {
        const { vehicle_id, ...update } = payload
        const { error } = await supabase.from('pending_work').update(update).eq('id', itemId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('pending_work').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending_work', vehicleId] })
      qc.invalidateQueries({ queryKey: ['pending_work_open'] })
      navigate(`/vehicles/${vehicleId}?tab=pending`)
    },
  })

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-bold">
          {isEditing ? 'Edit Pending Work Item' : 'Add Pending Work Item'}
        </h1>
      </div>

      <form
        onSubmit={handleSubmit(d => mutation.mutate(d))}
        className="p-4 space-y-4 max-w-lg mx-auto pb-10"
      >
        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {mutation.error?.message || 'Something went wrong.'}
          </div>
        )}

        <div>
          <label className="field-label">Title *</label>
          <input
            {...register('title', { required: 'Title is required' })}
            placeholder="e.g. Replace front tires"
            className={`field-input ${errors.title ? 'border-red-400' : ''}`}
          />
          {errors.title && <p className="text-xs text-red-600 mt-0.5">{errors.title.message}</p>}
        </div>

        <div>
          <label className="field-label">Description</label>
          <textarea
            {...register('description')}
            rows={4}
            placeholder="Details, specs needed, context, why it matters…"
            className="field-textarea"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Priority</label>
            <select {...register('priority')} className="field-select">
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">⚪ Low</option>
              <option value="watch">👁 Watch</option>
              <option value="conditional">⚙️ Conditional</option>
            </select>
          </div>
          <div>
            <label className="field-label">Status</label>
            <select {...register('status')} className="field-select">
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="deferred">Deferred</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Estimated Cost</label>
            <input
              {...register('estimated_cost')}
              placeholder="~$250–350"
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label">Identified Date</label>
            <input {...register('identified_date')} type="date" className="field-input" />
          </div>
        </div>

        <div>
          <label className="field-label">Identified By / Source</label>
          <input
            {...register('identified_by')}
            placeholder="e.g. NTB inspection, Steve's Auto, Self"
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label">Notes</label>
          <textarea
            {...register('notes')}
            rows={3}
            placeholder="Additional context, follow-up steps…"
            className="field-textarea"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Item'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
