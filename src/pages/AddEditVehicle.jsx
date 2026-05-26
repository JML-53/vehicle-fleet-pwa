import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'

export default function AddEditVehicle() {
  const { id } = useParams()   // undefined when adding new
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEditing = !!id

  const { data: existing } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: { status: 'active' },
  })

  useEffect(() => {
    if (existing) reset(existing)
  }, [existing, reset])

  const mutation = useMutation({
    mutationFn: async (values) => {
      // Coerce numeric fields
      const payload = {
        ...values,
        year:      values.year      ? Number(values.year)      : null,
        cylinders: values.cylinders ? Number(values.cylinders) : null,
        // Leave VIN as null if blank so UNIQUE constraint isn't violated
        vin: values.vin?.trim() || null,
      }
      if (isEditing) {
        const { error } = await supabase.from('vehicles').update(payload).eq('id', id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('vehicles').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] })
      if (isEditing) qc.invalidateQueries({ queryKey: ['vehicle', id] })
      navigate(isEditing ? `/vehicles/${id}` : '/vehicles')
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
        <h1 className="text-xl font-bold">{isEditing ? 'Edit Vehicle' : 'Add Vehicle'}</h1>
      </div>

      <form
        onSubmit={handleSubmit(d => mutation.mutate(d))}
        className="p-4 space-y-4 max-w-lg mx-auto pb-10"
      >
        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {mutation.error?.message || 'Something went wrong. Please try again.'}
          </div>
        )}

        {/* Identity */}
        <div className="card space-y-3">
          <h2 className="card-header">Identity</h2>
          <div>
            <label className="field-label">Nickname / Name</label>
            <input
              {...register('name')}
              placeholder="e.g. The Rover, Blue Burb"
              className="field-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Year *</label>
              <input
                {...register('year', { required: 'Year is required' })}
                type="number"
                placeholder="2011"
                className={`field-input ${errors.year ? 'border-red-400' : ''}`}
              />
              {errors.year && <p className="text-xs text-red-600 mt-0.5">{errors.year.message}</p>}
            </div>
            <div>
              <label className="field-label">Status</label>
              <select {...register('status')} className="field-select">
                <option value="active">Active</option>
                <option value="project">Project</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="field-label">Make *</label>
              <input
                {...register('make', { required: 'Make is required' })}
                placeholder="Chevrolet"
                className={`field-input ${errors.make ? 'border-red-400' : ''}`}
              />
            </div>
            <div>
              <label className="field-label">Model *</label>
              <input
                {...register('model', { required: 'Model is required' })}
                placeholder="Suburban"
                className={`field-input ${errors.model ? 'border-red-400' : ''}`}
              />
            </div>
            <div>
              <label className="field-label">Trim</label>
              <input {...register('trim')} placeholder="LTZ" className="field-input" />
            </div>
            <div>
              <label className="field-label">Color</label>
              <input {...register('color')} placeholder="Blue" className="field-input" />
            </div>
          </div>
          <div>
            <label className="field-label">Primary Driver</label>
            <input {...register('primary_driver')} placeholder="Joe" className="field-input" />
          </div>
        </div>

        {/* Engine */}
        <div className="card space-y-3">
          <h2 className="card-header">Engine</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Engine Size</label>
              <input {...register('engine_size')} placeholder="5.0L" className="field-input" />
            </div>
            <div>
              <label className="field-label">Cylinders</label>
              <input
                {...register('cylinders', { valueAsNumber: true })}
                type="number"
                placeholder="8"
                className="field-input"
              />
            </div>
          </div>
        </div>

        {/* Registration */}
        <div className="card space-y-3">
          <h2 className="card-header">Registration & Title</h2>
          <div>
            <label className="field-label">VIN</label>
            <input
              {...register('vin')}
              placeholder="17-character VIN"
              className="field-input font-mono text-sm"
              maxLength={17}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">License Plate</label>
              <input
                {...register('current_plate')}
                placeholder="609A1S"
                className="field-input font-mono"
              />
            </div>
            <div>
              <label className="field-label">Title Number</label>
              <input {...register('title_number')} className="field-input" />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="card space-y-3">
          <h2 className="card-header">Notes</h2>
          <textarea
            {...register('notes')}
            rows={4}
            placeholder="Known issues, history, warnings…"
            className="field-textarea"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="btn-primary flex-1"
          >
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Vehicle'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
