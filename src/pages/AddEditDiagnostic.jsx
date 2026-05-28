import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'

export default function AddEditDiagnostic() {
  const { id: vehicleId } = useParams()
  const [searchParams] = useSearchParams()
  const codeId = searchParams.get('edit')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEditing = !!codeId

  const { data: existing } = useQuery({
    queryKey: ['diagnostic_code', codeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('diagnostic_codes').select('*').eq('id', codeId).single()
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
      const payload = {
        ...values,
        vehicle_id: vehicleId,
        pulled_date:  values.pulled_date  || null,
        cleared_date: values.cleared_date || null,
      }
      if (isEditing) {
        const { vehicle_id, ...update } = payload
        const { error } = await supabase.from('diagnostic_codes').update(update).eq('id', codeId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('diagnostic_codes').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnostic_codes', vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=diagnostic`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('diagnostic_codes').delete().eq('id', codeId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnostic_codes', vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=diagnostic`)
    },
  })

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-bold">{isEditing ? 'Edit Diagnostic Code' : 'Add Diagnostic Code'}</h1>
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
            <label className="field-label">Code *</label>
            <input
              {...register('code', { required: 'Code is required' })}
              placeholder="P0016"
              className={`field-input font-mono ${errors.code ? 'border-red-400' : ''}`}
            />
          </div>
          <div>
            <label className="field-label">Tool Used</label>
            <input {...register('tool_used')} placeholder="e.g. Autel MD806" className="field-input" />
          </div>
        </div>

        <div>
          <label className="field-label">Description</label>
          <input {...register('description')}
            placeholder="e.g. Crankshaft Position – Camshaft Position Correlation"
            className="field-input" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Date Pulled</label>
            <input {...register('pulled_date')} type="date" className="field-input" />
          </div>
          <div>
            <label className="field-label">Date Cleared</label>
            <input {...register('cleared_date')} type="date" className="field-input" />
            <p className="text-xs text-slate-400 mt-0.5">Leave blank if still open</p>
          </div>
        </div>

        <div>
          <label className="field-label">Resolution / Notes</label>
          <textarea {...register('resolution')} rows={3}
            placeholder="What was done, what caused it, what to watch for…"
            className="field-textarea" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Code'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">Cancel</button>
          {isEditing && (
            <button type="button"
              onClick={() => { if (window.confirm('Delete this code?')) deleteMutation.mutate() }}
              className="btn-danger">Delete</button>
          )}
        </div>
      </form>
    </div>
  )
}
