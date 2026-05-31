import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'
import { format, addMonths, endOfMonth, parseISO } from 'date-fns'

// Virginia rule: inspection expires end of month, interval_months from inspection month
function calcExpiryDate(inspectionDate, intervalMonths) {
  if (!inspectionDate || !intervalMonths) return ''
  const d = typeof inspectionDate === 'string' ? parseISO(inspectionDate) : inspectionDate
  return format(endOfMonth(addMonths(d, intervalMonths)), 'yyyy-MM-dd')
}

const INTERVAL = { safety: 12, emissions: 24 }

function useVehicle(id) {
  return useQuery({
    queryKey: ['vehicle', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

function useShops() {
  return useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const { data, error } = await supabase.from('shops').select('id, name, is_self').order('name')
      if (error) throw error
      return data
    },
  })
}

function useInspectionTemplate(vehicleId, type) {
  return useQuery({
    queryKey: ['inspection_template', vehicleId, type],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('inspection_type', type)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },
    enabled: !!vehicleId && !!type,
  })
}

function useFulfillmentForEdit(fulfillmentId) {
  return useQuery({
    queryKey: ['inspection_fulfillment', fulfillmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspection_fulfillments')
        .select('*, inspections(inspection_type, vehicle_id)')
        .eq('id', fulfillmentId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!fulfillmentId,
  })
}

export default function AddInspection() {
  const { id: vehicleId } = useParams()
  const [searchParams] = useSearchParams()
  const fulfillmentId = searchParams.get('edit')
  const isEditing = !!fulfillmentId
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: vehicle } = useVehicle(vehicleId)
  const { data: shops = [] } = useShops()
  const { data: existing } = useFulfillmentForEdit(fulfillmentId)

  const today = format(new Date(), 'yyyy-MM-dd')

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm({
    defaultValues: {
      inspection_type: 'safety',
      inspection_date: today,
      expiry_date:     calcExpiryDate(today, INTERVAL.safety),
      result:          'pass',
      report_number:   '',
      shop_id:         '',
      mileage:         '',
      notes:           '',
    },
  })

  // Load existing fulfillment into form when editing
  useEffect(() => {
    if (existing) {
      reset({
        inspection_type: existing.inspections?.inspection_type || 'safety',
        inspection_date: existing.inspection_date || today,
        expiry_date:     existing.expiry_date || '',
        result:          existing.result || 'pass',
        report_number:   existing.report_number || '',
        shop_id:         existing.shop_id || '',
        mileage:         existing.mileage_at_inspection || '',
        notes:           existing.notes || '',
      })
    }
  }, [existing, reset, today])

  // Auto-recalculate expiry when date or type changes
  const watchedDate = watch('inspection_date')
  const watchedType = watch('inspection_type')
  useEffect(() => {
    if (watchedDate && watchedType) {
      setValue('expiry_date', calcExpiryDate(watchedDate, INTERVAL[watchedType]))
    }
  }, [watchedDate, watchedType, setValue])

  // Find the inspection template row for this vehicle/type
  const { data: template } = useInspectionTemplate(vehicleId, watchedType)

  const mutation = useMutation({
    mutationFn: async (values) => {
      const mileage = values.mileage ? parseInt(values.mileage, 10) : null

      if (isEditing) {
        // Edit mode: update the fulfillment row only
        const { error } = await supabase
          .from('inspection_fulfillments')
          .update({
            inspection_date:       values.inspection_date,
            expiry_date:           values.expiry_date || null,
            result:                values.result || null,
            report_number:         values.report_number || null,
            shop_id:               values.shop_id || null,
            mileage_at_inspection: mileage,
            notes:                 values.notes || null,
          })
          .eq('id', fulfillmentId)
        if (error) throw error
      } else {
        // Create mode: service_visit → service_record → inspection_fulfillments

        // 1. Create service visit
        const { data: visit, error: visitErr } = await supabase
          .from('service_visits')
          .insert({
            vehicle_id: vehicleId,
            shop_id:    values.shop_id || null,
            visit_date: values.inspection_date,
            visit_type: 'inspection',
            notes:      values.notes || null,
          })
          .select('id')
          .single()
        if (visitErr) throw visitErr

        // 2. Log mileage if provided
        if (mileage) {
          await supabase.from('mileage_log').insert({
            vehicle_id:       vehicleId,
            recorded_date:    values.inspection_date,
            mileage,
            source:           'service_visit',
            service_visit_id: visit.id,
          })
        }

        // 3. Create service record
        const { data: record, error: recErr } = await supabase
          .from('service_records')
          .insert({
            vehicle_id:  vehicleId,
            visit_id:    visit.id,
            service_date: values.inspection_date,
            category:    'inspection',
            title:       values.inspection_type === 'safety'
                           ? 'Safety Inspection'
                           : 'Emissions Inspection',
            source:      'manual',
          })
          .select('id')
          .single()
        if (recErr) throw recErr

        // 4. Ensure inspection template row exists for this vehicle/type
        let inspectionId = template?.id
        if (!inspectionId) {
          const { data: newTemplate, error: tErr } = await supabase
            .from('inspections')
            .insert({
              vehicle_id:      vehicleId,
              inspection_type: values.inspection_type,
              interval_months: INTERVAL[values.inspection_type],
            })
            .select('id')
            .single()
          if (tErr) throw tErr
          inspectionId = newTemplate.id
        }

        // 5. Create inspection_fulfillments row
        const { error: infErr } = await supabase
          .from('inspection_fulfillments')
          .insert({
            inspection_id:         inspectionId,
            service_record_id:     record.id,
            inspection_date:       values.inspection_date,
            expiry_date:           values.expiry_date || null,
            result:                values.result || null,
            report_number:         values.report_number || null,
            shop_id:               values.shop_id || null,
            mileage_at_inspection: mileage,
            notes:                 values.notes || null,
          })
        if (infErr) throw infErr
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspections',       vehicleId] })
      qc.invalidateQueries({ queryKey: ['inspection_status'] })
      qc.invalidateQueries({ queryKey: ['service_visits',    vehicleId] })
      qc.invalidateQueries({ queryKey: ['service_history',   vehicleId] })
      qc.invalidateQueries({ queryKey: ['mileage',           vehicleId] })
      navigate(`/vehicles/${vehicleId}?tab=inspections`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Remove fulfillment row; leave service_record/visit in place for history
      const { error } = await supabase
        .from('inspection_fulfillments')
        .delete()
        .eq('id', fulfillmentId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspections',       vehicleId] })
      qc.invalidateQueries({ queryKey: ['inspection_status'] })
      navigate(`/vehicles/${vehicleId}?tab=inspections`)
    },
  })

  const vehicleName = vehicle
    ? (vehicle.name || `${vehicle.year} ${vehicle.make} ${vehicle.model}`)
    : '…'

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
          {isEditing ? 'Edit Inspection' : 'Log Inspection'}
        </h1>
        <p className="text-primary-300 text-sm mt-0.5">{vehicleName}</p>
      </div>

      <form
        onSubmit={handleSubmit(d => mutation.mutate(d))}
        className="p-4 space-y-4 max-w-lg mx-auto pb-10"
      >
        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {mutation.error?.message}
          </div>
        )}

        {/* Type — locked in edit mode since it determines which template row */}
        <div>
          <label className="field-label">Inspection Type *</label>
          <select
            {...register('inspection_type', { required: true })}
            className="field-select"
            disabled={isEditing}
          >
            <option value="safety">Safety</option>
            <option value="emissions">Emissions</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Inspection Date *</label>
            <input
              {...register('inspection_date', { required: 'Date is required' })}
              type="date"
              className={`field-input ${errors.inspection_date ? 'border-red-400' : ''}`}
            />
          </div>
          <div>
            <label className="field-label">
              Expiry Date
              <span className="text-slate-400 font-normal ml-1">(auto-calculated)</span>
            </label>
            <input
              {...register('expiry_date')}
              type="date"
              className="field-input"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Result</label>
            <select {...register('result')} className="field-select">
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
            </select>
          </div>
          <div>
            <label className="field-label">Sticker / Report #</label>
            <input
              {...register('report_number')}
              placeholder="e.g. 4821903"
              className="field-input font-mono"
            />
          </div>
        </div>

        <div>
          <label className="field-label">Shop</label>
          <select {...register('shop_id')} className="field-select">
            <option value="">— Select shop —</option>
            {shops.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label">Mileage at Inspection</label>
          <input
            {...register('mileage')}
            type="number"
            placeholder="e.g. 87500"
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label">Notes</label>
          <textarea
            {...register('notes')}
            rows={3}
            placeholder="Any notes about this inspection…"
            className="field-textarea"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="btn-primary flex-1"
          >
            {mutation.isPending
              ? 'Saving…'
              : isEditing ? 'Save Changes' : 'Log Inspection'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="btn-secondary"
          >
            Cancel
          </button>
          {isEditing && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Remove this inspection record?')) deleteMutation.mutate()
              }}
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
