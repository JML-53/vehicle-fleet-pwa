import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useForm, useFieldArray } from 'react-hook-form'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'

const SERVICE_CATEGORIES = [
  'oil_change','brakes','tires','suspension','electrical','ac_hvac','engine',
  'transmission','inspection','registration','modification','diagnostic',
  'fuel_system','cooling','other',
]

function useShops() {
  return useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shops').select('id, name, is_self').order('name')
      if (error) throw error
      return data
    },
  })
}

function useVehicle(id) {
  return useQuery({
    queryKey: ['vehicle', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles').select('id, name, year, make, model').eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

export default function AddServiceRecord() {
  const { id: vehicleId } = useParams()
  const navigate          = useNavigate()
  const queryClient       = useQueryClient()

  const { data: vehicle } = useVehicle(vehicleId)
  const { data: shops }   = useShops()
  const [serverError, setServerError] = useState('')
  const [addVisit, setAddVisit] = useState(true)

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      service_date: new Date().toISOString().split('T')[0],
      category:     'other',
      title:        '',
      description:  '',
      labor_cost:   '',
      parts_cost:   '',
      total_cost:   '',
      notes:        '',
      // visit fields
      shop_id:      '',
      work_order:   '',
      invoice_number: '',
      technician:   '',
      visit_type:   'shop',
      mileage:      '',
      parts:        [],
    },
  })

  const { fields: partFields, append: addPart, remove: removePart } = useFieldArray({
    control,
    name: 'parts',
  })

  const mutation = useMutation({
    mutationFn: async (formData) => {
      let visitId = null

      // 1. If mileage provided, insert into mileage_log first
      let mileageLogId = null
      if (formData.mileage) {
        const { data: ml, error: mlErr } = await supabase
          .from('mileage_log')
          .insert({
            vehicle_id:    vehicleId,
            recorded_date: formData.service_date,
            mileage:       parseInt(formData.mileage),
            source:        'service_visit',
          })
          .select('id')
          .single()
        if (mlErr) throw mlErr
        mileageLogId = ml.id
      }

      // 2. Create service_visit if requested
      if (addVisit) {
        const visitPayload = {
          vehicle_id:     vehicleId,
          visit_date:     formData.service_date,
          visit_type:     formData.visit_type,
          shop_id:        formData.shop_id || null,
          work_order:     formData.work_order || null,
          invoice_number: formData.invoice_number || null,
          technician:     formData.technician || null,
          total_cost:     formData.total_cost ? parseFloat(formData.total_cost) : null,
        }
        const { data: visit, error: visitErr } = await supabase
          .from('service_visits').insert(visitPayload).select('id').single()
        if (visitErr) throw visitErr

        // Back-link mileage_log to this visit
        if (mileageLogId) {
          await supabase
            .from('mileage_log')
            .update({ service_visit_id: visit.id })
            .eq('id', mileageLogId)
        }
        visitId = visit.id
      }

      // 3. Insert service_record
      const recordPayload = {
        vehicle_id:   vehicleId,
        visit_id:     visitId,
        service_date: formData.service_date,
        category:     formData.category,
        title:        formData.title,
        description:  formData.description || null,
        labor_cost:   formData.labor_cost ? parseFloat(formData.labor_cost) : null,
        parts_cost:   formData.parts_cost ? parseFloat(formData.parts_cost) : null,
        total_cost:   formData.total_cost ? parseFloat(formData.total_cost) : null,
        notes:        formData.notes || null,
        source:       'manual',
      }
      const { data: record, error: recErr } = await supabase
        .from('service_records').insert(recordPayload).select('id').single()
      if (recErr) throw recErr

      // 4. Insert parts
      if (formData.parts?.length) {
        const partsPayload = formData.parts
          .filter(p => p.part_name?.trim())
          .map(p => ({
            service_record_id: record.id,
            part_name:    p.part_name,
            part_number:  p.part_number || null,
            manufacturer: p.manufacturer || null,
            vendor:       p.vendor || null,
            order_number: p.order_number || null,
            quantity:     p.quantity ? parseFloat(p.quantity) : 1,
            unit_cost:    p.unit_cost ? parseFloat(p.unit_cost) : null,
            total_cost:   p.total_cost ? parseFloat(p.total_cost) : null,
          }))
        if (partsPayload.length) {
          const { error: partsErr } = await supabase.from('parts').insert(partsPayload)
          if (partsErr) throw partsErr
        }
      }

      return record
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service_history', vehicleId] })
      queryClient.invalidateQueries({ queryKey: ['mileage', vehicleId] })
      queryClient.invalidateQueries({ queryKey: ['recent_service'] })
      navigate(`/vehicles/${vehicleId}`)
    },
    onError: (err) => {
      setServerError(err.message || 'Failed to save. Please try again.')
    },
  })

  const onSubmit = (data) => {
    setServerError('')
    mutation.mutate(data)
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
        <h1 className="text-lg font-bold">Add Service Record</h1>
        {vehicle && (
          <p className="text-primary-200 text-sm mt-0.5">
            {vehicle.name || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-6 max-w-2xl mx-auto w-full">

        {/* ---- Core record fields ---- */}
        <div className="card space-y-4">
          <h2 className="card-header">Service Details</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Date *</label>
              <input type="date" className="field-input" {...register('service_date', { required: true })} />
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
              placeholder="e.g. Oil change — full synthetic 5W-30"
              {...register('title', { required: 'Title is required' })}
            />
            {errors.title && (
              <p className="text-xs text-red-500 mt-1">{errors.title.message}</p>
            )}
          </div>

          <div>
            <label className="field-label">Description</label>
            <textarea
              className="field-textarea"
              rows={3}
              placeholder="Additional details, findings, tech notes…"
              {...register('description')}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="field-label">Labor $</label>
              <input type="number" step="0.01" className="field-input" placeholder="0.00" {...register('labor_cost')} />
            </div>
            <div>
              <label className="field-label">Parts $</label>
              <input type="number" step="0.01" className="field-input" placeholder="0.00" {...register('parts_cost')} />
            </div>
            <div>
              <label className="field-label">Total $</label>
              <input type="number" step="0.01" className="field-input" placeholder="0.00" {...register('total_cost')} />
            </div>
          </div>

          <div>
            <label className="field-label">Notes</label>
            <textarea
              className="field-textarea"
              rows={2}
              placeholder="Parts declined, caveats, future watch items…"
              {...register('notes')}
            />
          </div>
        </div>

        {/* ---- Visit details ---- */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="card-header mb-0">Visit / Shop Info</h2>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={addVisit}
                onChange={e => setAddVisit(e.target.checked)}
                className="rounded"
              />
              Include
            </label>
          </div>

          {addVisit && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Shop</label>
                  <select className="field-select" {...register('shop_id')}>
                    <option value="">— select shop —</option>
                    {(shops || []).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">Visit Type</label>
                  <select className="field-select" {...register('visit_type')}>
                    <option value="shop">Shop</option>
                    <option value="self">Self / DIY</option>
                    <option value="dealer">Dealer</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Work Order #</label>
                  <input type="text" className="field-input" placeholder="WO-223047" {...register('work_order')} />
                </div>
                <div>
                  <label className="field-label">Invoice #</label>
                  <input type="text" className="field-input" {...register('invoice_number')} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Technician</label>
                  <input type="text" className="field-input" {...register('technician')} />
                </div>
                <div>
                  <label className="field-label">Mileage at Visit</label>
                  <input
                    type="number"
                    className="field-input"
                    placeholder="e.g. 177866"
                    {...register('mileage')}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* ---- Parts ---- */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="card-header mb-0">Parts Used</h2>
            <button
              type="button"
              onClick={() => addPart({ part_name: '', part_number: '', manufacturer: '', vendor: '', order_number: '', quantity: 1, unit_cost: '', total_cost: '' })}
              className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
            >
              <Plus size={12} /> Add Part
            </button>
          </div>

          {partFields.length === 0 && (
            <p className="text-xs text-slate-400 italic">No parts added. Click "Add Part" to track parts used.</p>
          )}

          {partFields.map((field, idx) => (
            <div key={field.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Part {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removePart(idx)}
                  className="text-red-400 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div>
                <label className="field-label">Part Name *</label>
                <input type="text" className="field-input" placeholder="e.g. Eagle Sport All-Season 285/45R22" {...register(`parts.${idx}.part_name`)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Part Number</label>
                  <input type="text" className="field-input" placeholder="P/N" {...register(`parts.${idx}.part_number`)} />
                </div>
                <div>
                  <label className="field-label">Manufacturer</label>
                  <input type="text" className="field-input" {...register(`parts.${idx}.manufacturer`)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Vendor</label>
                  <input type="text" className="field-input" placeholder="e.g. Holley, NAPA" {...register(`parts.${idx}.vendor`)} />
                </div>
                <div>
                  <label className="field-label">Order #</label>
                  <input type="text" className="field-input" {...register(`parts.${idx}.order_number`)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="field-label">Qty</label>
                  <input type="number" step="0.01" className="field-input" defaultValue={1} {...register(`parts.${idx}.quantity`)} />
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

        {/* Error / submit */}
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
            {mutation.isPending ? 'Saving…' : 'Save Service Record'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="btn-secondary py-3 px-5"
          >
            Cancel
          </button>
        </div>

      </form>
    </div>
  )
}
