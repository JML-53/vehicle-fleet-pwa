import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'

export default function AddMaintenanceItem() {
  const { id: vehicleId } = useParams()
  const [searchParams] = useSearchParams()
  const itemId = searchParams.get('edit')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEditing = !!itemId

  const { data: existing } = useQuery({
    queryKey: ['maintenance_item', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_schedule').select('*').eq('id', itemId).single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  const { register, handleSubmit, reset, formState: { errors }, watch } = useForm({
    defaultValues: {
      knowledge_status: 'unknown',
      priority: 'medium',
    },
  })

  useEffect(() => {
    if (existing) reset(existing)
  }, [existing, reset])

  const knowledgeStatus = watch('knowledge_status')

  const mutation = useMutation({
    mutationFn: async (values) => {
      const clean = {
        ...values,
        vehicle_id: vehicleId,
        interval_months:      values.interval_months      ? Number(values.interval_months)      : null,
        interval_miles:       values.interval_miles       ? Number(values.interval_miles)       : null,
        last_service_mileage: values.last_service_mileage ? Number(values.last_service_mileage) : null,
        last_done_date:       values.last_done_date || null,
        baseline_date:        values.baseline_date  || null,
        next_due_date:        values.next_due_date  || null,
      }
      if (isEditing) {
        const { vehicle_id, ...update } = clean
        const { error } = await supabase
          .from('maintenance_schedule').update(update).eq('id', itemId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('maintenance_schedule').insert(clean)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] })
      qc.invalidateQueries({ queryKey: ['maintenance_due_soon_all'] })
      navigate(`/vehicles/${vehicleId}?tab=maintenance`)
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
          {isEditing ? 'Edit Maintenance Item' : 'Add Maintenance Item'}
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

        {/* Item name */}
        <div>
          <label className="field-label">Service Item *</label>
          <input
            {...register('service_item', { required: 'Service item name is required' })}
            placeholder="e.g. Engine Oil & Filter"
            className={`field-input ${errors.service_item ? 'border-red-400' : ''}`}
          />
          {errors.service_item && (
            <p className="text-xs text-red-600 mt-0.5">{errors.service_item.message}</p>
          )}
        </div>

        {/* Interval */}
        <div className="card space-y-3">
          <h2 className="card-header">Interval</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Every (months)</label>
              <input
                {...register('interval_months')}
                type="number"
                min="1"
                placeholder="12"
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label">Every (miles)</label>
              <input
                {...register('interval_miles')}
                type="number"
                min="1"
                placeholder="10000"
                className="field-input"
              />
            </div>
          </div>
          <p className="text-xs text-slate-400">Fill one or both — service triggers at whichever comes first.</p>
        </div>

        {/* Last service */}
        <div className="card space-y-3">
          <h2 className="card-header">Last Service</h2>
          <div>
            <label className="field-label">Confidence Level</label>
            <select {...register('knowledge_status')} className="field-select">
              <option value="confirmed">Confirmed — from a service record</option>
              <option value="estimated">Estimated — reasonably sure</option>
              <option value="assumed">Assumed — best guess</option>
              <option value="unknown">Unknown — no data</option>
            </select>
          </div>
          {knowledgeStatus !== 'unknown' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">
                  {knowledgeStatus === 'confirmed' ? 'Last Done Date' : 'Baseline Date'}
                </label>
                <input
                  {...register(knowledgeStatus === 'confirmed' ? 'last_done_date' : 'baseline_date')}
                  type="date"
                  className="field-input"
                />
              </div>
              <div>
                <label className="field-label">Last Done Mileage</label>
                <input
                  {...register('last_service_mileage')}
                  type="number"
                  placeholder="89940"
                  className="field-input"
                />
              </div>
            </div>
          )}
        </div>

        {/* Next due (optional override) */}
        <div className="card space-y-3">
          <h2 className="card-header">Next Due (optional override)</h2>
          <p className="text-xs text-slate-400 -mt-1">
            Leave blank — the database calculates this automatically from last service + interval.
            Set manually only if you need to override the calculation.
          </p>
          <div>
            <label className="field-label">Next Due Date</label>
            <input {...register('next_due_date')} type="date" className="field-input" />
          </div>
        </div>

        {/* Priority & notes */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Priority</label>
            <select {...register('priority')} className="field-select">
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        <div>
          <label className="field-label">Notes</label>
          <textarea
            {...register('notes')}
            rows={3}
            placeholder="Part specs, torque values, cost estimates, reminders…"
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
