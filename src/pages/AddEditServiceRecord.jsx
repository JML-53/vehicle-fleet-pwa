/**
 * AddEditServiceRecord — edit an existing service_record (and its parts).
 * Route: /vehicles/:id/service/:recordId/edit
 *
 * Loaded from:
 *  - ServiceHistoryTab pencil button
 *  - ServiceVisitsTab  pencil button on individual records
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'

const SERVICE_CATEGORIES = [
  'oil_change','brakes','tires','suspension','electrical','ac_hvac','engine',
  'transmission','inspection','registration','modification','diagnostic',
  'fuel_system','cooling','other',
]

export default function AddEditServiceRecord() {
  const { id: vehicleId, recordId } = useParams()
  const navigate    = useNavigate()
  const qc          = useQueryClient()
  const [serverError, setServerError] = useState('')

  // Load existing record
  const { data: existing, isLoading } = useQuery({
    queryKey: ['service_record', recordId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_records')
        .select('*, parts(*)')
        .eq('id', recordId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!recordId,
  })

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: {
      service_date: '',
      category:     'other',
      title:        '',
      description:  '',
      labor_cost:   '',
      parts_cost:   '',
      total_cost:   '',
      notes:        '',
      parts:        [],
    },
  })

  const { fields: partFields, append: addPart, remove: removePart } = useFieldArray({
    control,
    name: 'parts',
  })

  // Populate form when existing record loads
  useEffect(() => {
    if (existing) {
      reset({
        service_date: existing.service_date || '',
        category:     existing.category     || 'other',
        title:        existing.title        || '',
        description:  existing.description  || '',
        labor_cost:   existing.labor_cost   != null ? String(existing.labor_cost) : '',
        parts_cost:   existing.parts_cost   != null ? String(existing.parts_cost) : '',
        total_cost:   existing.total_cost   != null ? String(existing.total_cost) : '',
        notes:        existing.notes        || '',
        parts: (existing.parts || []).map(p => ({
          _id:          p.id,
          part_name:    p.part_name    || '',
          part_number:  p.part_number  || '',
          manufacturer: p.manufacturer || '',
          vendor:       p.vendor       || '',
          order_number: p.order_number || '',
          quantity:     String(p.quantity ?? 1),
          unit_cost:    p.unit_cost    != null ? String(p.unit_cost)  : '',
          total_cost:   p.total_cost   != null ? String(p.total_cost) : '',
        })),
      })
    }
  }, [existing, reset])

  const mutation = useMutation({
    mutationFn: async (formData) => {
      // 1. Update service_record
      const { error: recErr } = await supabase
        .from('service_records')
        .update({
          service_date: formData.service_date || null,
          category:     formData.category,
          title:        formData.title,
          description:  formData.description  || null,
          labor_cost:   formData.labor_cost   ? parseFloat(formData.labor_cost)  : null,
          parts_cost:   formData.parts_cost   ? parseFloat(formData.parts_cost)  : null,
          total_cost:   formData.total_cost   ? parseFloat(formData.total_cost)  : null,
          notes:        formData.notes        || null,
        })
        .eq('id', recordId)
      if (recErr) throw recErr

      // 2. Handle parts — delete removed, upsert remaining
      const existingPartIds = (existing?.parts || []).map(p => p.id)
      const submittedIds    = formData.parts.filter(p => p._id).map(p => p._id)
      const deletedIds      = existingPartIds.filter(id => !submittedIds.includes(id))

      if (deletedIds.length) {
        const { error } = await supabase.from('parts').delete().in('id', deletedIds)
        if (error) throw error
      }

      for (const p of formData.parts.filter(p => p.part_name?.trim())) {
        const payload = {
          service_record_id: recordId,
          part_name:    p.part_name,
          part_number:  p.part_number  || null,
          manufacturer: p.manufacturer || null,
          vendor:       p.vendor       || null,
          order_number: p.order_number || null,
          quantity:     p.quantity     ? parseFloat(p.quantity) : 1,
          unit_cost:    p.unit_cost    ? parseFloat(p.unit_cost)    : null,
          total_cost:   p.total_cost   ? parseFloat(p.total_cost)   : null,
        }
        if (p._id) {
          const { error } = await supabase.from('parts').update(payload).eq('id', p._id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('parts').insert(payload)
          if (error) throw error
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_history', vehicleId] })
      qc.invalidateQueries({ queryKey: ['service_visits',  vehicleId] })
      qc.invalidateQueries({ queryKey: ['recent_service'] })
      navigate(`/vehicles/${vehicleId}?tab=service`)
    },
    onError: (err) => setServerError(err.message || 'Save failed.'),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Delete parts first (FK constraint)
      await supabase.from('parts').delete().eq('service_record_id', recordId)
      const { error } = await supabase.from('service_records').delete().eq('id', recordId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_history', vehicleId] })
      qc.invalidateQueries({ queryKey: ['service_visits',  vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=service`)
    },
    onError: (err) => setServerError(err.message || 'Delete failed.'),
  })

  function confirmDelete() {
    if (window.confirm('Delete this service record and all its parts? This cannot be undone.')) {
      deleteMutation.mutate()
    }
  }

  if (isLoading) {
    return <div className="p-4 text-slate-400 text-sm animate-pulse">Loading record…</div>
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="bg-primary-900 text-white px-4 py-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-2 hover:text-white"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-lg font-bold">Edit Service Record</h1>
        {existing && (
          <p className="text-primary-200 text-sm mt-0.5">{existing.title}</p>
        )}
      </div>

      <form onSubmit={handleSubmit(d => { setServerError(''); mutation.mutate(d) })}
            className="p-4 space-y-6 max-w-2xl mx-auto w-full">

        {/* ---- Core fields ---- */}
        <div className="card space-y-4">
          <h2 className="card-header">Service Details</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Date</label>
              <input type="date" className="field-input" {...register('service_date')} />
            </div>
            <div>
              <label className="field-label">Category</label>
              <select className="field-select" {...register('category')}>
                {SERVICE_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="field-label">Title / Summary *</label>
            <input
              type="text"
              className="field-input"
              {...register('title', { required: 'Title is required' })}
            />
            {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title.message}</p>}
          </div>

          <div>
            <label className="field-label">Description</label>
            <textarea className="field-textarea" rows={3} {...register('description')} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="field-label">Labor $</label>
              <input type="number" step="0.01" className="field-input" {...register('labor_cost')} />
            </div>
            <div>
              <label className="field-label">Parts $</label>
              <input type="number" step="0.01" className="field-input" {...register('parts_cost')} />
            </div>
            <div>
              <label className="field-label">Total $</label>
              <input type="number" step="0.01" className="field-input" {...register('total_cost')} />
            </div>
          </div>

          <div>
            <label className="field-label">Notes</label>
            <textarea className="field-textarea" rows={2} {...register('notes')} />
          </div>
        </div>

        {/* ---- Parts ---- */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="card-header mb-0">Parts Used</h2>
            <button
              type="button"
              onClick={() => addPart({ _id: null, part_name: '', part_number: '', manufacturer: '', vendor: '', order_number: '', quantity: '1', unit_cost: '', total_cost: '' })}
              className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
            >
              <Plus size={12} /> Add Part
            </button>
          </div>

          {partFields.length === 0 && (
            <p className="text-xs text-slate-400 italic">No parts. Click "Add Part" to add one.</p>
          )}

          {partFields.map((field, idx) => (
            <div key={field.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Part {idx + 1}</span>
                <button type="button" onClick={() => removePart(idx)} className="text-red-400 hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              </div>
              {/* hidden _id field so we can upsert vs insert */}
              <input type="hidden" {...register(`parts.${idx}._id`)} />
              <div>
                <label className="field-label">Part Name *</label>
                <input type="text" className="field-input" {...register(`parts.${idx}.part_name`)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Part Number</label>
                  <input type="text" className="field-input" {...register(`parts.${idx}.part_number`)} />
                </div>
                <div>
                  <label className="field-label">Manufacturer</label>
                  <input type="text" className="field-input" {...register(`parts.${idx}.manufacturer`)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Vendor</label>
                  <input type="text" className="field-input" {...register(`parts.${idx}.vendor`)} />
                </div>
                <div>
                  <label className="field-label">Order #</label>
                  <input type="text" className="field-input" {...register(`parts.${idx}.order_number`)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="field-label">Qty</label>
                  <input type="number" step="0.01" className="field-input" {...register(`parts.${idx}.quantity`)} />
                </div>
                <div>
                  <label className="field-label">Unit $</label>
                  <input type="number" step="0.01" className="field-input" {...register(`parts.${idx}.unit_cost`)} />
                </div>
                <div>
                  <label className="field-label">Total $</label>
                  <input type="number" step="0.01" className="field-input" {...register(`parts.${idx}.total_cost`)} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {serverError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {serverError}
          </p>
        )}

        <div className="flex gap-3 pb-4">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex-1 btn-primary py-3 text-base disabled:opacity-60"
          >
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary py-3 px-5">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={deleteMutation.isPending}
            className="btn-danger py-3 px-4 disabled:opacity-60"
            title="Delete this record"
          >
            <Trash2 size={16} />
          </button>
        </div>

      </form>
    </div>
  )
}
