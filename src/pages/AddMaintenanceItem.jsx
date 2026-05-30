/**
 * AddMaintenanceItem — add or edit a maintenance_schedule entry.
 *
 * With the Task-12 schema change, last_done_date / last_done_mileage are no
 * longer stored directly on maintenance_schedule. They are derived by the
 * maintenance_due_soon view from the linked maintenance_fulfillments rows.
 *
 * This form manages fulfillments as an inline list:
 *   • Shows existing links (each with a remove button)
 *   • Add-link dropdown picks from the vehicle's service_records
 *   • baseline_date / knowledge_status remain for "estimated/assumed" cases
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Link2, Plus, Trash2, ExternalLink } from 'lucide-react'
import { format, parseISO } from 'date-fns'

export default function AddMaintenanceItem() {
  const { id: vehicleId } = useParams()
  const [searchParams]    = useSearchParams()
  const itemId            = searchParams.get('edit')
  const navigate          = useNavigate()
  const qc                = useQueryClient()
  const isEditing         = !!itemId

  // ── Track fulfillment links locally ────────────────────────────────────────
  // Each entry: { id (uuid or null for new), service_record_id, _remove: bool }
  const [fulfillments,    setFulfillments]    = useState([])
  const [addLinkRecordId, setAddLinkRecordId] = useState('')

  // ── Existing maintenance item ───────────────────────────────────────────────
  const { data: existing } = useQuery({
    queryKey: ['maintenance_item', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_schedule').select('*').eq('id', itemId).single()
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  // ── Existing fulfillments for this item ────────────────────────────────────
  const { data: existingFulfillments = [] } = useQuery({
    queryKey: ['fulfillments', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_fulfillments')
        .select(`
          id,
          service_record_id,
          notes,
          service_records(id, title, service_date, mileage_at_service, category)
        `)
        .eq('maintenance_schedule_id', itemId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: isEditing,
  })

  // ── Service records for this vehicle (for the add-link picker) ─────────────
  const { data: serviceRecords = [] } = useQuery({
    queryKey: ['service_records_for_vehicle', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_records')
        .select('id, title, service_date, mileage_at_service, category')
        .eq('vehicle_id', vehicleId)
        .order('service_date', { ascending: false })
        .limit(200)
      if (error) throw error
      return data
    },
  })

  // ── Form ───────────────────────────────────────────────────────────────────
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm({
    defaultValues: {
      knowledge_status: 'unknown',
      priority:         'medium',
      baseline_date:    '',
      notes:            '',
    },
  })

  // Populate form when editing
  useEffect(() => {
    if (existing) {
      reset({
        service_item:     existing.service_item     || '',
        category:         existing.category         || 'other',
        interval_months:  existing.interval_months  != null ? String(existing.interval_months) : '',
        interval_miles:   existing.interval_miles   != null ? String(existing.interval_miles)  : '',
        priority:         existing.priority         || 'medium',
        knowledge_status: existing.knowledge_status || 'unknown',
        baseline_date:    existing.baseline_date    || '',
        notes:            existing.notes            || '',
      })
    }
  }, [existing, reset])

  // Populate fulfillments list when existing data loads
  useEffect(() => {
    if (existingFulfillments.length > 0) {
      setFulfillments(existingFulfillments.map(f => ({
        id:               f.id,
        service_record_id: f.service_record_id,
        notes:            f.notes,
        _rec:             f.service_records,
        _remove:          false,
      })))
    }
  }, [existingFulfillments])

  const knowledgeStatus = watch('knowledge_status')

  // ── Add a fulfillment link ─────────────────────────────────────────────────
  function handleAddLink() {
    if (!addLinkRecordId) return
    // Prevent duplicates
    if (fulfillments.some(f => f.service_record_id === addLinkRecordId && !f._remove)) return
    const rec = serviceRecords.find(r => r.id === addLinkRecordId)
    setFulfillments(prev => [...prev, {
      id:               null,
      service_record_id: addLinkRecordId,
      notes:            null,
      _rec:             rec,
      _remove:          false,
    }])
    setAddLinkRecordId('')
    // Auto-set confidence to confirmed if not already set
  }

  function handleRemoveLink(idx) {
    setFulfillments(prev => prev.map((f, i) =>
      i === idx ? { ...f, _remove: true } : f
    ))
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async (values) => {
      const clean = {
        vehicle_id:      vehicleId,
        service_item:    values.service_item,
        category:        values.category        || null,
        interval_months: values.interval_months ? Number(values.interval_months) : null,
        interval_miles:  values.interval_miles  ? Number(values.interval_miles)  : null,
        priority:        values.priority        || 'medium',
        knowledge_status: values.knowledge_status || 'unknown',
        baseline_date:   values.baseline_date   || null,
        notes:           values.notes           || null,
      }

      let resolvedItemId = itemId

      if (isEditing) {
        const { vehicle_id, ...update } = clean
        const { error } = await supabase
          .from('maintenance_schedule').update(update).eq('id', itemId)
        if (error) throw error
      } else {
        const { data: newItem, error } = await supabase
          .from('maintenance_schedule').insert(clean).select('id').single()
        if (error) throw error
        resolvedItemId = newItem.id
      }

      // ── Sync fulfillments ──────────────────────────────────────────────────

      // Remove deleted links
      const toRemove = fulfillments.filter(f => f._remove && f.id)
      for (const f of toRemove) {
        await supabase.from('maintenance_fulfillments').delete().eq('id', f.id)
      }

      // Insert new links
      const toAdd = fulfillments.filter(f => !f._remove && !f.id)
      for (const f of toAdd) {
        await supabase.from('maintenance_fulfillments').insert({
          maintenance_schedule_id: resolvedItemId,
          service_record_id:       f.service_record_id,
          notes:                   f.notes,
        })
      }

      // Auto-set confidence to 'confirmed' if we have any active fulfillments
      const hasActive = fulfillments.some(f => !f._remove)
      if (hasActive && clean.knowledge_status !== 'confirmed') {
        await supabase.from('maintenance_schedule')
          .update({ knowledge_status: 'confirmed' })
          .eq('id', resolvedItemId)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] })
      qc.invalidateQueries({ queryKey: ['maintenance_due_soon_all'] })
      qc.invalidateQueries({ queryKey: ['fulfillments', itemId] })
      navigate(`/vehicles/${vehicleId}?tab=maintenance`)
    },
  })

  // ── Service records not yet linked (for picker) ───────────────────────────
  const linkedIds = new Set(fulfillments.filter(f => !f._remove).map(f => f.service_record_id))
  const availableRecords = serviceRecords.filter(r => !linkedIds.has(r.id))

  const activeFulfillments = fulfillments.filter(f => !f._remove)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-bold">
          {isEditing ? 'Edit Maintenance Item' : 'Add Maintenance Item'}
        </h1>
      </div>

      <form
        onSubmit={handleSubmit(d => mutation.mutate(d))}
        className="p-4 space-y-4 max-w-lg mx-auto pb-10"
      >
        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {mutation.error?.message || 'Something went wrong.'}
          </div>
        )}

        {/* ── Service Item name ── */}
        <div>
          <label className="field-label">Service Item *</label>
          <input
            {...register('service_item', { required: 'Service item name is required' })}
            placeholder="e.g. Engine Oil & Filter"
            className={`field-input ${errors.service_item ? 'border-red-400' : ''}`}
          />
          {errors.service_item && (
            <p className="text-xs text-red-600 mt-0.5">{errors.service_item.message}</p>
          )}
        </div>

        {/* ── Category ── */}
        <div>
          <label className="field-label">Category</label>
          <select {...register('category')} className="field-select">
            {['oil_change','brakes','tires','suspension','electrical','ac_hvac','engine',
              'transmission','inspection','registration','modification','diagnostic',
              'fuel_system','cooling','other'].map(c => (
              <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* ── Interval ── */}
        <div className="card space-y-3">
          <h2 className="card-header">Interval</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Every (months)</label>
              <input {...register('interval_months')} type="number" min="1"
                placeholder="12" className="field-input" />
            </div>
            <div>
              <label className="field-label">Every (miles)</label>
              <input {...register('interval_miles')} type="number" min="1"
                placeholder="10000" className="field-input" />
            </div>
          </div>
          <p className="text-xs text-slate-400">Fill one or both — triggers at whichever comes first.</p>
        </div>

        {/* ── Linked Service Records (fulfillments) ── */}
        <div className="card space-y-3">
          <h2 className="card-header flex items-center gap-1.5">
            <Link2 size={13} className="text-primary-500" />
            Linked Service Records
          </h2>
          <p className="text-xs text-slate-500">
            Link to service records that represent when this maintenance was performed.
            Last done date and mileage are derived from the most recent link.
          </p>

          {/* Existing links */}
          {activeFulfillments.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No service records linked yet.</p>
          ) : (
            <div className="space-y-2">
              {activeFulfillments.map((f, idx) => {
                const rec = f._rec
                const realIdx = fulfillments.indexOf(f)
                return (
                  <div key={f.id || f.service_record_id}
                    className="flex items-center gap-2 bg-primary-50 border border-primary-100 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">
                        {rec?.service_date ? format(parseISO(rec.service_date), 'MMM d, yyyy') : '—'}
                        {rec?.title ? ` · ${rec.title}` : ''}
                      </p>
                      {rec?.mileage_at_service && (
                        <p className="text-xs text-slate-500">
                          {Number(rec.mileage_at_service).toLocaleString()} mi
                        </p>
                      )}
                      {!f.id && (
                        <span className="text-[10px] text-amber-600 font-medium">unsaved</span>
                      )}
                    </div>
                    <button type="button"
                      onClick={() => navigate(`/vehicles/${vehicleId}/service/${f.service_record_id}/edit`)}
                      className="text-primary-400 hover:text-primary-700 p-1" title="View record">
                      <ExternalLink size={12} />
                    </button>
                    <button type="button" onClick={() => handleRemoveLink(realIdx)}
                      className="text-red-400 hover:text-red-600 p-1" title="Remove link">
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Add link */}
          <div className="flex gap-2">
            <select
              value={addLinkRecordId}
              onChange={e => setAddLinkRecordId(e.target.value)}
              className="field-select flex-1 text-xs"
            >
              <option value="">— select a service record to link —</option>
              {availableRecords.map(r => (
                <option key={r.id} value={r.id}>
                  {r.service_date} · {r.title}
                  {r.mileage_at_service ? ` · ${Number(r.mileage_at_service).toLocaleString()} mi` : ''}
                </option>
              ))}
            </select>
            <button type="button" onClick={handleAddLink}
              disabled={!addLinkRecordId}
              className="btn-secondary px-3 py-2 text-xs flex items-center gap-1 disabled:opacity-40">
              <Plus size={12} /> Link
            </button>
          </div>
        </div>

        {/* ── Confidence / Baseline ── */}
        <div className="card space-y-3">
          <h2 className="card-header">Knowledge Confidence</h2>

          <div>
            <label className="field-label">Confidence Level</label>
            <select {...register('knowledge_status')} className="field-select">
              <option value="confirmed">Confirmed — linked to a service record above</option>
              <option value="estimated">Estimated — reasonably sure of the date</option>
              <option value="assumed">Assumed — best guess</option>
              <option value="unknown">Unknown — no data</option>
            </select>
          </div>

          {knowledgeStatus !== 'confirmed' && knowledgeStatus !== 'unknown' && (
            <div>
              <label className="field-label">
                Baseline Date
                <span className="text-slate-400 font-normal text-xs ml-1">
                  (used when no service record is linked)
                </span>
              </label>
              <input {...register('baseline_date')} type="date" className="field-input" />
            </div>
          )}
        </div>

        {/* ── Priority & Notes ── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Priority</label>
            <select {...register('priority')} className="field-select">
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        <div>
          <label className="field-label">Notes</label>
          <textarea {...register('notes')} rows={3}
            placeholder="Part specs, torque values, cost estimates, reminders…"
            className="field-textarea" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Item'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
