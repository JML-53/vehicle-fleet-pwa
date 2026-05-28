import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'

export default function AddEditNote() {
  const { id: vehicleId } = useParams()
  const [searchParams] = useSearchParams()
  const noteId = searchParams.get('edit')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEditing = !!noteId

  const { data: existing } = useQuery({
    queryKey: ['note', noteId],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_notes').select('*').eq('id', noteId).single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: { category: 'observation', is_pinned: false },
  })

  useEffect(() => {
    if (existing) reset({ ...existing, is_pinned: existing.is_pinned ?? false })
  }, [existing, reset])

  const mutation = useMutation({
    mutationFn: async (values) => {
      const payload = {
        ...values,
        vehicle_id: vehicleId,
        note_date: values.note_date || new Date().toISOString().slice(0, 10),
        is_pinned: values.is_pinned === true || values.is_pinned === 'true',
      }
      if (isEditing) {
        const { vehicle_id, ...update } = payload
        const { error } = await supabase.from('vehicle_notes').update(update).eq('id', noteId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('vehicle_notes').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle_notes', vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=notes`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('vehicle_notes').delete().eq('id', noteId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle_notes', vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=notes`)
    },
  })

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-bold">{isEditing ? 'Edit Note' : 'Add Note'}</h1>
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
            <label className="field-label">Category</label>
            <select {...register('category')} className="field-select">
              <option value="warning">⚠️ Warning</option>
              <option value="observation">👁 Observation</option>
              <option value="tip">💡 Tip</option>
              <option value="history">📋 History</option>
              <option value="quirk">🔧 Quirk</option>
              <option value="other">📁 Other</option>
            </select>
          </div>
          <div>
            <label className="field-label">Date</label>
            <input {...register('note_date')} type="date" className="field-input" />
          </div>
        </div>

        <div>
          <label className="field-label">Note *</label>
          <textarea
            {...register('note_text', { required: 'Note text is required' })}
            rows={5}
            placeholder="What do you want to record about this vehicle?"
            className={`field-textarea ${errors.note_text ? 'border-red-400' : ''}`}
          />
          {errors.note_text && <p className="text-xs text-red-600 mt-0.5">{errors.note_text.message}</p>}
        </div>

        <div>
          <label className="field-label">Author</label>
          <input {...register('created_by')} placeholder="e.g. Joe" className="field-input" />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input {...register('is_pinned')} type="checkbox" className="w-4 h-4 rounded" />
          <span className="text-sm text-slate-700">Pin this note (shows at top, highlighted)</span>
        </label>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Note'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">Cancel</button>
          {isEditing && (
            <button
              type="button"
              onClick={() => { if (window.confirm('Delete this note?')) deleteMutation.mutate() }}
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
