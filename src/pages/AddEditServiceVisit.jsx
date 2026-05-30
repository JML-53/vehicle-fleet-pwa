/**
 * AddEditServiceVisit — create or edit a complete service visit:
 *   visit header (shop, date, mileage, WO, invoice)
 *   + one or more service_record rows, each with optional parts
 *
 * Routes:
 *   /vehicles/:id/add-visit              — new visit
 *   /vehicles/:id/visits/:visitId/edit   — edit existing visit
 *
 * Item 6 Use Cases:
 *   UC-1: manual entry of shop visit → fill in records + parts
 *   UC-2: manual entry of DIY work   → shop = "Self / Owner"
 *
 * The AI-parse-from-document path will call this page pre-populated
 * with data returned from the parse-document Edge Function.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'

const SERVICE_CATEGORIES = [
  'oil_change','brakes','tires','suspension','electrical','ac_hvac','engine',
  'transmission','inspection','registration','modification','diagnostic',
  'fuel_system','cooling','other',
]

const EMPTY_RECORD = () => ({
  _id:         null,
  title:       '',
  category:    'other',
  description: '',
  labor_cost:  '',
  parts_cost:  '',
  total_cost:  '',
  notes:       '',
  parts:       [],
})

const EMPTY_PART = () => ({
  _id:          null,
  part_name:    '',
  part_number:  '',
  manufacturer: '',
  vendor:       '',
  order_number: '',
  quantity:     '1',
  unit_cost:    '',
  total_cost:   '',
})

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

function PartRow({ idx, recIdx, register, remove }) {
  return (
    <div className="border border-slate-100 rounded p-2 space-y-2 bg-white">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 font-medium">Part {idx + 1}</span>
        <button type="button" onClick={remove} className="text-red-400 hover:text-red-600">
          <Trash2 size={13} />
        </button>
      </div>
      <input type="hidden" {...register(`records.${recIdx}.parts.${idx}._id`)} />
      <div>
        <label className="field-label">Part Name *</label>
        <input type="text" className="field-input text-xs" {...register(`records.${recIdx}.parts.${idx}.part_name`)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label">Part #</label>
          <input type="text" className="field-input text-xs" {...register(`records.${recIdx}.parts.${idx}.part_number`)} />
        </div>
        <div>
          <label className="field-label">Manufacturer</label>
          <input type="text" className="field-input text-xs" {...register(`records.${recIdx}.parts.${idx}.manufacturer`)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label">Vendor</label>
          <input type="text" className="field-input text-xs" {...register(`records.${recIdx}.parts.${idx}.vendor`)} />
        </div>
        <div>
          <label className="field-label">Order #</label>
          <input type="text" className="field-input text-xs" {...register(`records.${recIdx}.parts.${idx}.order_number`)} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="field-label">Qty</label>
          <input type="number" step="0.01" className="field-input text-xs" {...register(`records.${recIdx}.parts.${idx}.quantity`)} />
        </div>
        <div>
          <label className="field-label">Unit $</label>
          <input type="number" step="0.01" className="field-input text-xs" {...register(`records.${recIdx}.parts.${idx}.unit_cost`)} />
        </div>
        <div>
          <label className="field-label">Total $</label>
          <input type="number" step="0.01" className="field-input text-xs" {...register(`records.${recIdx}.parts.${idx}.total_cost`)} />
        </div>
      </div>
    </div>
  )
}

function RecordSection({ recIdx, register, control, remove, isOnly }) {
  const [open, setOpen] = useState(true)
  const { fields: partFields, append: addPart, remove: removePart } = useFieldArray({
    control,
    name: `records.${recIdx}.parts`,
  })
  // hidden _id
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Record header bar */}
      <div className="flex items-center gap-2 bg-slate-50 px-3 py-2">
        <button type="button" onClick={() => setOpen(o => !o)} className="text-slate-400">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="text-xs font-semibold text-slate-600 flex-1">
          Service Item {recIdx + 1}
        </span>
        {!isOnly && (
          <button type="button" onClick={remove}
            className="text-red-400 hover:text-red-600 text-xs flex items-center gap-0.5">
            <Trash2 size={12} /> Remove
          </button>
        )}
      </div>

      {open && (
        <div className="p-3 space-y-3">
          <input type="hidden" {...register(`records.${recIdx}._id`)} />

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="field-label">Title / Summary *</label>
              <input type="text" className="field-input"
                placeholder="e.g. Oil change — full synthetic 5W-30"
                {...register(`records.${recIdx}.title`, { required: true })} />
            </div>
            <div>
              <label className="field-label">Category</label>
              <select className="field-select" {...register(`records.${recIdx}.category`)}>
                {SERVICE_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="field-label">Description</label>
            <textarea className="field-textarea" rows={2}
              placeholder="Tech notes, findings, details…"
              {...register(`records.${recIdx}.description`)} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="field-label">Labor $</label>
              <input type="number" step="0.01" className="field-input"
                {...register(`records.${recIdx}.labor_cost`)} />
            </div>
            <div>
              <label className="field-label">Parts $</label>
              <input type="number" step="0.01" className="field-input"
                {...register(`records.${recIdx}.parts_cost`)} />
            </div>
            <div>
              <label className="field-label">Total $</label>
              <input type="number" step="0.01" className="field-input"
                {...register(`records.${recIdx}.total_cost`)} />
            </div>
          </div>

          <div>
            <label className="field-label">Notes</label>
            <textarea className="field-textarea" rows={2}
              {...register(`records.${recIdx}.notes`)} />
          </div>

          {/* Parts sub-section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Parts</span>
              <button type="button"
                onClick={() => addPart(EMPTY_PART())}
                className="text-xs text-primary-600 hover:text-primary-800 flex items-center gap-0.5 font-medium">
                <Plus size={11} /> Add Part
              </button>
            </div>
            {partFields.length === 0 && (
              <p className="text-xs text-slate-400 italic">No parts for this item.</p>
            )}
            {partFields.map((pf, pidx) => (
              <PartRow
                key={pf.id}
                idx={pidx}
                recIdx={recIdx}
                register={register}
                remove={() => removePart(pidx)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AddEditServiceVisit() {
  const { id: vehicleId, visitId } = useParams()
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const isEditing  = !!visitId
  const [serverError, setServerError] = useState('')

  const { data: shops } = useShops()

  // Load existing visit + records + parts when editing
  const { data: existing, isLoading } = useQuery({
    queryKey: ['service_visit_full', visitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_visits')
        .select(`
          *,
          service_records(
            id, title, category, description, labor_cost, parts_cost, total_cost, notes,
            parts(id, part_name, part_number, manufacturer, vendor, order_number, quantity, unit_cost, total_cost)
          )
        `)
        .eq('id', visitId)
        .single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  const { register, control, handleSubmit, reset, watch } = useForm({
    defaultValues: {
      visit_date:     new Date().toISOString().split('T')[0],
      shop_id:        '',
      visit_type:     'shop',
      work_order:     '',
      invoice_number: '',
      technician:     '',
      mileage:        '',
      total_cost:     '',
      notes:          '',
      records:        [EMPTY_RECORD()],
    },
  })

  const { fields: recFields, append: addRecord, remove: removeRecord } = useFieldArray({
    control,
    name: 'records',
  })

  useEffect(() => {
    if (existing) {
      reset({
        visit_date:     existing.visit_date      || '',
        shop_id:        existing.shop_id         || '',
        visit_type:     existing.visit_type      || 'shop',
        work_order:     existing.work_order      || '',
        invoice_number: existing.invoice_number  || '',
        technician:     existing.technician      || '',
        mileage:        '',
        total_cost:     existing.total_cost != null ? String(existing.total_cost) : '',
        notes:          existing.notes          || '',
        records: (existing.service_records || [EMPTY_RECORD()]).map(r => ({
          _id:         r.id,
          title:       r.title       || '',
          category:    r.category    || 'other',
          description: r.description || '',
          labor_cost:  r.labor_cost  != null ? String(r.labor_cost)  : '',
          parts_cost:  r.parts_cost  != null ? String(r.parts_cost)  : '',
          total_cost:  r.total_cost  != null ? String(r.total_cost)  : '',
          notes:       r.notes       || '',
          parts: (r.parts || []).map(p => ({
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
        })),
      })
    }
  }, [existing, reset])

  const mutation = useMutation({
    mutationFn: async (formData) => {
      let resolvedVisitId = visitId

      // 1. Mileage log entry (new visits only — editing skips this)
      let mileageLogId = null
      if (!isEditing && formData.mileage) {
        const { data: ml, error } = await supabase
          .from('mileage_log')
          .insert({
            vehicle_id:    vehicleId,
            recorded_date: formData.visit_date,
            mileage:       parseInt(formData.mileage),
            source:        'service_visit',
          })
          .select('id').single()
        if (error) throw error
        mileageLogId = ml.id
      }

      // 2. Upsert visit
      const visitPayload = {
        vehicle_id:     vehicleId,
        visit_date:     formData.visit_date,
        visit_type:     formData.visit_type,
        shop_id:        formData.shop_id        || null,
        work_order:     formData.work_order      || null,
        invoice_number: formData.invoice_number  || null,
        technician:     formData.technician      || null,
        total_cost:     formData.total_cost      ? parseFloat(formData.total_cost) : null,
        notes:          formData.notes           || null,
      }

      if (isEditing) {
        const { error } = await supabase.from('service_visits').update(visitPayload).eq('id', visitId)
        if (error) throw error
      } else {
        const { data: visit, error } = await supabase
          .from('service_visits').insert(visitPayload).select('id').single()
        if (error) throw error
        resolvedVisitId = visit.id
        if (mileageLogId) {
          await supabase.from('mileage_log').update({ service_visit_id: resolvedVisitId }).eq('id', mileageLogId)
        }
      }

      // 3. Upsert / delete service records
      const existingRecordIds = (existing?.service_records || []).map(r => r.id)
      const submittedRecordIds = formData.records.filter(r => r._id).map(r => r._id)
      const deletedRecordIds   = existingRecordIds.filter(id => !submittedRecordIds.includes(id))

      // Delete removed records (parts cascade via FK if set up, otherwise delete manually)
      for (const rid of deletedRecordIds) {
        await supabase.from('parts').delete().eq('service_record_id', rid)
        await supabase.from('service_records').delete().eq('id', rid)
      }

      // Upsert each record + its parts
      for (const rec of formData.records.filter(r => r.title?.trim())) {
        const recPayload = {
          vehicle_id:   vehicleId,
          visit_id:     resolvedVisitId,
          service_date: formData.visit_date,
          category:     rec.category,
          title:        rec.title,
          description:  rec.description  || null,
          labor_cost:   rec.labor_cost   ? parseFloat(rec.labor_cost)  : null,
          parts_cost:   rec.parts_cost   ? parseFloat(rec.parts_cost)  : null,
          total_cost:   rec.total_cost   ? parseFloat(rec.total_cost)  : null,
          notes:        rec.notes        || null,
          source:       'manual',
        }

        let recordId = rec._id
        if (rec._id) {
          const { error } = await supabase.from('service_records').update(recPayload).eq('id', rec._id)
          if (error) throw error
        } else {
          const { data: newRec, error } = await supabase
            .from('service_records').insert(recPayload).select('id').single()
          if (error) throw error
          recordId = newRec.id
        }

        // Parts for this record
        const existingPartIds  = rec._id
          ? ((existing?.service_records || []).find(r => r.id === rec._id)?.parts || []).map(p => p.id)
          : []
        const submittedPartIds = (rec.parts || []).filter(p => p._id).map(p => p._id)
        const deletedPartIds   = existingPartIds.filter(id => !submittedPartIds.includes(id))

        if (deletedPartIds.length) {
          await supabase.from('parts').delete().in('id', deletedPartIds)
        }

        for (const p of (rec.parts || []).filter(p => p.part_name?.trim())) {
          const partPayload = {
            service_record_id: recordId,
            part_name:    p.part_name,
            part_number:  p.part_number  || null,
            manufacturer: p.manufacturer || null,
            vendor:       p.vendor       || null,
            order_number: p.order_number || null,
            quantity:     p.quantity     ? parseFloat(p.quantity) : 1,
            unit_cost:    p.unit_cost    ? parseFloat(p.unit_cost)   : null,
            total_cost:   p.total_cost   ? parseFloat(p.total_cost)  : null,
          }
          if (p._id) {
            await supabase.from('parts').update(partPayload).eq('id', p._id)
          } else {
            await supabase.from('parts').insert(partPayload)
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_history', vehicleId] })
      qc.invalidateQueries({ queryKey: ['service_visits',  vehicleId] })
      qc.invalidateQueries({ queryKey: ['mileage',         vehicleId] })
      qc.invalidateQueries({ queryKey: ['recent_service'] })
      navigate(`/vehicles/${vehicleId}?tab=visits`)
    },
    onError: (err) => setServerError(err.message || 'Save failed.'),
  })

  if (isEditing && isLoading) {
    return <div className="p-4 text-slate-400 text-sm animate-pulse">Loading visit…</div>
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-2 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-lg font-bold">
          {isEditing ? 'Edit Service Visit' : 'Log Service Visit'}
        </h1>
        <p className="text-primary-200 text-xs mt-0.5">
          {isEditing ? 'Update visit details, records, and parts.' : 'Record a shop visit or DIY service with all line items and parts.'}
        </p>
      </div>

      <form onSubmit={handleSubmit(d => { setServerError(''); mutation.mutate(d) })}
            className="p-4 space-y-6 max-w-2xl mx-auto w-full">

        {/* ---- Visit header ---- */}
        <div className="card space-y-4">
          <h2 className="card-header">Visit Details</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Date *</label>
              <input type="date" className="field-input"
                {...register('visit_date', { required: true })} />
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
              <label className="field-label">Shop</label>
              <select className="field-select" {...register('shop_id')}>
                <option value="">— select shop —</option>
                {(shops || []).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Mileage at Visit</label>
              <input type="number" className="field-input" placeholder="e.g. 177866"
                {...register('mileage')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Work Order #</label>
              <input type="text" className="field-input" {...register('work_order')} />
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
              <label className="field-label">Visit Total $</label>
              <input type="number" step="0.01" className="field-input" {...register('total_cost')} />
            </div>
          </div>

          <div>
            <label className="field-label">Visit Notes</label>
            <textarea className="field-textarea" rows={2} {...register('notes')} />
          </div>
        </div>

        {/* ---- Service records ---- */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="card-header mb-0">Service Items</h2>
            <button
              type="button"
              onClick={() => addRecord(EMPTY_RECORD())}
              className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1"
            >
              <Plus size={12} /> Add Item
            </button>
          </div>

          {recFields.map((rf, ridx) => (
            <RecordSection
              key={rf.id}
              recIdx={ridx}
              register={register}
              control={control}
              remove={() => removeRecord(ridx)}
              isOnly={recFields.length === 1}
            />
          ))}
        </div>

        {serverError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {serverError}
          </p>
        )}

        <div className="flex gap-3 pb-4">
          <button type="submit" disabled={mutation.isPending}
            className="flex-1 btn-primary py-3 text-base disabled:opacity-60">
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Save Visit'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary py-3 px-5">
            Cancel
          </button>
        </div>

      </form>
    </div>
  )
}
