import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'

const CATEGORIES = ['Tires', 'Engine Oil', 'AC / Refrigerant', 'Paint', 'Keys / Fobs',
  'Transmission', 'Coolant', 'Battery', 'Fluids', 'Dimensions', 'Other']

export default function AddEditSpec() {
  const { id: vehicleId } = useParams()
  const [searchParams] = useSearchParams()
  const specId = searchParams.get('edit')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEditing = !!specId

  const { data: existing } = useQuery({
    queryKey: ['spec', specId],
    queryFn: async () => {
      const { data, error } = await supabase.from('known_specs').select('*').eq('id', specId).single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm()

  useEffect(() => {
    if (existing) reset(existing)
  }, [existing, reset])

  const mutation = useMutation({
    mutationFn: async (values) => {
      const payload = { ...values, vehicle_id: vehicleId }
      if (isEditing) {
        const { vehicle_id, ...update } = payload
        const { error } = await supabase.from('known_specs').update(update).eq('id', specId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('known_specs').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['known_specs', vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=specs`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('known_specs').delete().eq('id', specId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['known_specs', vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=specs`)
    },
  })

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-bold">{isEditing ? 'Edit Spec' : 'Add Spec'}</h1>
      </div>

      <form onSubmit={handleSubmit(d => mutation.mutate(d))}
        className="p-4 space-y-4 max-w-lg mx-auto pb-10">
        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {mutation.error?.message}
          </div>
        )}

        <div>
          <label className="field-label">Category *</label>
          <input
            {...register('spec_category', { required: true })}
            list="spec-categories"
            placeholder="e.g. Tires, Engine Oil, AC / Refrigerant"
            className="field-input"
          />
          <datalist id="spec-categories">
            {CATEGORIES.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>

        <div>
          <label className="field-label">Spec Name *</label>
          <input
            {...register('spec_name', { required: 'Name is required' })}
            placeholder="e.g. Front Tire Pressure, Oil Type, Refrigerant Amount"
            className={`field-input ${errors.spec_name ? 'border-red-400' : ''}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Value *</label>
            <input
              {...register('spec_value', { required: 'Value is required' })}
              placeholder="e.g. 35, 5W-30, LRC825"
              className={`field-input ${errors.spec_value ? 'border-red-400' : ''}`}
            />
          </div>
          <div>
            <label className="field-label">Units</label>
            <input {...register('units')} placeholder="e.g. psi, qt, g" className="field-input" />
          </div>
        </div>

        <div>
          <label className="field-label">Notes</label>
          <textarea {...register('notes')} rows={2} className="field-textarea" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Spec'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">Cancel</button>
          {isEditing && (
            <button type="button"
              onClick={() => { if (window.confirm('Delete this spec?')) deleteMutation.mutate() }}
              className="btn-danger">Delete</button>
          )}
        </div>
      </form>
    </div>
  )
}
