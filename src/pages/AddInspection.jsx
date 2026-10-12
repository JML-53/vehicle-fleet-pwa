import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import DeleteOrRequest from '@/components/DeleteOrRequest'
import { createInspectionRepairItem, invalidatePending } from '@/lib/pendingWork'
import { ArrowLeft, ShieldX } from 'lucide-react'
import { format } from 'date-fns'
import { INTERVAL, GRACE, TYPE_WORDS, calcExpiryDate, calcDueDate } from '@/lib/inspections'

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
        .select('id, grace_days, inspection_type')
        .eq('vehicle_id', vehicleId)
        .eq('inspection_type', type)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data
    },
    enabled: !!vehicleId && !!type,
  })
}

function useRepairItem(fulfillmentId) {
  return useQuery({
    queryKey: ['pending_work', 'from_inspection', fulfillmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_work')
        .select('id, title, status')
        .eq('source_inspection_fulfillment_id', fulfillmentId)
        .limit(1)
      if (error) throw error
      return data[0] ?? null
    },
    enabled: !!fulfillmentId,
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
  const { data: existingRepair } = useRepairItem(fulfillmentId)

  const today = format(new Date(), 'yyyy-MM-dd')

  const { register, handleSubmit, watch, setValue, getValues, reset, formState: { errors } } = useForm({
    defaultValues: {
      inspection_type: 'safety',
      inspection_date: today,
      expiry_date:     calcExpiryDate(today, INTERVAL.safety),
      result:          'pass',
      report_number:   '',
      shop_id:         '',
      mileage:         '',
      notes:           '',
      repairs:         '',
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
        repairs:         existing.result === 'fail' ? (existing.notes || '') : '',
      })
    }
  }, [existing, reset, today])

  const watchedType   = watch('inspection_type')
  const watchedResult = watch('result')
  const isFail        = watchedResult === 'fail'

  // Find the inspection template row for this vehicle/type
  const { data: template } = useInspectionTemplate(vehicleId, watchedType)

  // Recalculate the due date only when the user changes date / type / result —
  // never on load, so a hand-entered re-test date on an existing record survives.
  function recalcDue() {
    const { inspection_date, inspection_type, result } = getValues()
    // On a type change the new type's template hasn't loaded yet — only use
    // template grace days when they belong to the type being calculated
    const grace = template?.inspection_type === inspection_type ? template.grace_days : undefined
    setValue('expiry_date', calcDueDate(inspection_date, inspection_type, result, grace))
    if (result === 'fail' && !getValues('repairs')) setValue('repairs', getValues('notes'))
  }

  const mutation = useMutation({
    mutationFn: async (values) => {
      const mileage = values.mileage ? parseInt(values.mileage, 10) : null
      let savedId = fulfillmentId

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

        // 0. One event, one record (item 9.3): if that day's visit already has a
        //    record for this inspection (e.g. from the uploaded receipt), attach
        //    to it instead of creating a duplicate visit + record.
        const { data: sameDay, error: sdErr } = await supabase
          .from('service_records')
          .select('id, title, category, inspection_fulfillments(id)')
          .eq('vehicle_id', vehicleId)
          .eq('service_date', values.inspection_date)
        if (sdErr) throw sdErr
        const match = (sameDay || []).find(r =>
          !r.inspection_fulfillments?.length &&
          (r.category === 'inspection' || /inspect/i.test(r.title)) &&
          TYPE_WORDS[values.inspection_type].test(r.title))
        if (match) {
          const inspectionId = template?.id
            ?? (await supabase.from('inspections')
                  .insert({ vehicle_id: vehicleId, inspection_type: values.inspection_type, interval_months: INTERVAL[values.inspection_type], grace_days: GRACE[values.inspection_type] })
                  .select('id').single()).data?.id
          const { data: newInf, error: infErr } = await supabase
            .from('inspection_fulfillments')
            .insert({
              inspection_id:         inspectionId,
              service_record_id:     match.id,
              inspection_date:       values.inspection_date,
              expiry_date:           values.expiry_date || null,
              result:                values.result || null,
              report_number:         values.report_number || null,
              shop_id:               values.shop_id || null,
              mileage_at_inspection: mileage,
              notes:                 values.notes || null,
            })
            .select('id').single()
          if (infErr) throw infErr
          savedId = newInf.id
        }
      }

      if (!isEditing && !savedId) {
        // 1. Create service visit
        const { data: visit, error: visitErr } = await supabase
          .from('service_visits')
          .insert({
            vehicle_id: vehicleId,
            shop_id:    values.shop_id || null,
            visit_date: values.inspection_date,
            visit_type: 'shop',
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
        const { data: newInf, error: infErr } = await supabase
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
          .select('id')
          .single()
        if (infErr) throw infErr
        savedId = newInf.id
      }

      // 6. Failed → "fix it" pending item referencing this inspection (once)
      if (values.result === 'fail' && !existingRepair) {
        await createInspectionRepairItem({
          vehicleId,
          fulfillmentId:  savedId,
          inspectionType: values.inspection_type,
          inspectionDate: values.inspection_date,
          repairs:        values.repairs,
          shopId:         values.shop_id,
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspections',       vehicleId] })
      qc.invalidateQueries({ queryKey: ['inspection_status'] })
      qc.invalidateQueries({ queryKey: ['service_visits',    vehicleId] })
      qc.invalidateQueries({ queryKey: ['service_history',   vehicleId] })
      qc.invalidateQueries({ queryKey: ['mileage',           vehicleId] })
      invalidatePending(qc, vehicleId)
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
            {...register('inspection_type', { required: true, onChange: recalcDue })}
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
              {...register('inspection_date', { required: 'Date is required', onChange: recalcDue })}
              type="date"
              className={`field-input ${errors.inspection_date ? 'border-red-400' : ''}`}
            />
          </div>
          <div>
            <label className="field-label">
              {isFail ? 'Re-test by' : 'Expiry Date'}
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
            <select {...register('result', { onChange: recalcDue })} className="field-select">
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

        {isFail && (
          <div className="card border border-purple-200 bg-purple-50 space-y-2">
            <h2 className="card-header text-purple-800 mb-0 flex items-center gap-1.5">
              <ShieldX size={14} /> Failed: repairs needed
            </h2>
            {existingRepair ? (
              <p className="text-sm text-purple-800">
                Tracked as pending work:{' '}
                <Link to={`/vehicles/${vehicleId}/add-pending?edit=${existingRepair.id}`}
                  className="underline font-medium">{existingRepair.title}</Link>
                {' '}({existingRepair.status.replace('_', ' ')}).
              </p>
            ) : (
              <>
                <textarea {...register('repairs')} rows={3} className="field-textarea bg-white"
                  placeholder="What has to be fixed to pass, e.g. Brakes and tires; codes P0300, P0442" />
                <p className="text-xs text-purple-700">
                  Saving creates a high-priority pending work item for this. Logging a passing re-test later closes it automatically.
                </p>
              </>
            )}
            <p className="text-xs text-purple-700">
              Re-test window: {(template?.inspection_type === watchedType && template?.grace_days) || GRACE[watchedType]} days for {watchedType} inspections on this vehicle.
            </p>
          </div>
        )}

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
            <DeleteOrRequest table="inspection_fulfillments" rowId={fulfillmentId} vehicleId={vehicleId}
              confirmText="Remove this inspection record?"
              onDelete={() => deleteMutation.mutate()} />
          )}
        </div>
      </form>
    </div>
  )
}
