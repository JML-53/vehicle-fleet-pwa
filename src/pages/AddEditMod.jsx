import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'

export default function AddEditMod() {
  const { id: vehicleId } = useParams()
  const [searchParams] = useSearchParams()
  const modId = searchParams.get('edit')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEditing = !!modId

  const { data: existing } = useQuery({
    queryKey: ['mod', modId],
    queryFn: async () => {
      const { data, error } = await supabase.from('modifications').select('*').eq('id', modId).single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: { category: 'other', install_type: 'self' },
  })

  useEffect(() => {
    if (existing) reset(existing)
  }, [existing, reset])

  const mutation = useMutation({
    mutationFn: async (values) => {
      const payload = {
        ...values,
        vehicle_id: vehicleId,
        mod_date: values.mod_date || null,
        cost: values.cost ? Number(values.cost) : null,
      }
      if (isEditing) {
        const { vehicle_id, ...update } = payload
        const { error } = await supabase.from('modifications').update(update).eq('id', modId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('modifications').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifications', vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=mods`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('modifications').delete().eq('id', modId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifications', vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=mods`)
    },
  })

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-bold">{isEditing ? 'Edit Modification' : 'Add Modification'}</h1>
      </div>

      <form onSubmit={handleSubmit(d => mutation.mutate(d))}
        className="p-4 space-y-4 max-w-lg mx-auto pb-10">
        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {mutation.error?.message}
          </div>
        )}

        <div>
          <label className="field-label">Description *</label>
          <input
            {...register('description', { required: 'Description is required' })}
            placeholder="e.g. Aftermarket cold air intake"
            className={`field-input ${errors.description ? 'border-red-400' : ''}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Category</label>
            <select {...register('category')} className="field-select">
              <option value="engine">Engine</option>
              <option value="suspension">Suspension / Lift</option>
              <option value="exterior">Exterior</option>
              <option value="interior">Interior</option>
              <option value="electrical">Electrical</option>
              <option value="exhaust">Exhaust</option>
              <option value="wheels_tires">Wheels / Tires</option>
              <option value="offroad">Off-Road</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="field-label">Installed By</label>
            <select {...register('install_type')} className="field-select">
              <option value="self">Self / DIY</option>
              <option value="shop">Shop</option>
              <option value="dealer">Dealer</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Manufacturer</label>
            <input {...register('manufacturer')} placeholder="e.g. Holley, Rancho" className="field-input" />
          </div>
          <div>
            <label className="field-label">Part Number</label>
            <input {...register('part_number')} className="field-input font-mono" />
          </div>
          <div>
            <label className="field-label">Vendor</label>
            <input {...register('vendor')} placeholder="e.g. Amazon, Summit Racing" className="field-input" />
          </div>
          <div>
            <label className="field-label">Order Number</label>
            <input {...register('order_number')} className="field-input" />
          </div>
          <div>
            <label className="field-label">Install Date</label>
            <input {...register('mod_date')} type="date" className="field-input" />
          </div>
          <div>
            <label className="field-label">Cost ($)</label>
            <input {...register('cost')} type="number" step="0.01" placeholder="0.00" className="field-input" />
          </div>
        </div>

        <div>
          <label className="field-label">Notes</label>
          <textarea {...register('notes')} rows={3} className="field-textarea" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Mod'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">Cancel</button>
          {isEditing && (
            <button type="button"
              onClick={() => { if (window.confirm('Delete this modification?')) deleteMutation.mutate() }}
              className="btn-danger">Delete</button>
          )}
        </div>
      </form>
    </div>
  )
}
