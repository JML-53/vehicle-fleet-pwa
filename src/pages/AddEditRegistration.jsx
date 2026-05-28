import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'

export default function AddEditRegistration() {
  const { id: vehicleId } = useParams()
  const [searchParams] = useSearchParams()
  const regId = searchParams.get('edit')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEditing = !!regId

  const { data: existing } = useQuery({
    queryKey: ['registration', regId],
    queryFn: async () => {
      const { data, error } = await supabase.from('registrations').select('*').eq('id', regId).single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: { state: 'VA', is_current: true },
  })

  useEffect(() => {
    if (existing) reset({ ...existing, is_current: existing.is_current ?? false })
  }, [existing, reset])

  const mutation = useMutation({
    mutationFn: async (values) => {
      const payload = {
        ...values,
        vehicle_id: vehicleId,
        registration_date: values.registration_date || null,
        expiry_date:       values.expiry_date       || null,
        is_current: values.is_current === true || values.is_current === 'true',
      }
      if (isEditing) {
        const { vehicle_id, ...update } = payload
        const { error } = await supabase.from('registrations').update(update).eq('id', regId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('registrations').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['registrations', vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=registrations`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('registrations').delete().eq('id', regId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['registrations', vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=registrations`)
    },
  })

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-bold">{isEditing ? 'Edit Registration' : 'Add Registration'}</h1>
      </div>

      <form onSubmit={handleSubmit(d => mutation.mutate(d))}
        className="p-4 space-y-4 max-w-lg mx-auto pb-10">
        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {mutation.error?.message}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">License Plate *</label>
            <input
              {...register('plate', { required: 'Plate is required' })}
              placeholder="609A1S"
              className={`field-input font-mono ${errors.plate ? 'border-red-400' : ''}`}
            />
          </div>
          <div>
            <label className="field-label">State</label>
            <input {...register('state')} placeholder="VA" className="field-input font-mono" />
          </div>
          <div>
            <label className="field-label">Registration Date</label>
            <input {...register('registration_date')} type="date" className="field-input" />
          </div>
          <div>
            <label className="field-label">Expiry Date</label>
            <input {...register('expiry_date')} type="date" className="field-input" />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input {...register('is_current')} type="checkbox" className="w-4 h-4 rounded" />
          <span className="text-sm text-slate-700">This is the current active registration</span>
        </label>

        <div>
          <label className="field-label">Notes</label>
          <textarea {...register('notes')} rows={2}
            placeholder="e.g. Previous plate, renewal notes…"
            className="field-textarea" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Registration'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">Cancel</button>
          {isEditing && (
            <button type="button"
              onClick={() => { if (window.confirm('Delete this registration?')) deleteMutation.mutate() }}
              className="btn-danger">Delete</button>
          )}
        </div>
      </form>
    </div>
  )
}
