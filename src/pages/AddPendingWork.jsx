/**
 * AddPendingWork — add or edit a pending work item (roadmap item 23).
 * Route: /vehicles/:id/add-pending[?edit=<uuid>]
 *
 * Assignment: who will do the work = a shop (incl. "Self / Owner") and/or a
 * family member. Work history lists the service records linked to this item;
 * a link marked "resolves" completes it (sync_pending_status trigger).
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, FilePlus2, Link2, CheckCircle2, CircleDashed, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useProfiles } from '@/lib/changeLog'
import {
  usePendingItem, useShopsList, PRIORITY_META, STATUS_META,
  setLinkResolves, unlink, invalidatePending, fromPendingState,
} from '@/lib/pendingWork'
import DeleteOrRequest from '@/components/DeleteOrRequest'
import CompletePendingSheet from '@/components/CompletePendingSheet'

const FIELDS = [
  'title', 'description', 'priority', 'status', 'estimated_cost', 'identified_date',
  'source', 'assigned_shop_id', 'assigned_to', 'notes',
]

export default function AddPendingWork() {
  const { id: vehicleId } = useParams()
  const [searchParams] = useSearchParams()
  const itemId    = searchParams.get('edit')   // ?edit=<uuid> for edit mode
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const isEditing = !!itemId
  const { profile } = useAuth()

  const { data: existing }      = usePendingItem(itemId)
  const { data: shops = [] }    = useShopsList()
  const { data: people = {} }   = useProfiles()
  const [linking, setLinking]   = useState(false)
  const [newShop, setNewShop]   = useState(null)   // null | '' (adding) | name

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm({
    defaultValues: {
      title: '', description: '', priority: 'medium', status: 'pending', estimated_cost: '',
      identified_date: new Date().toISOString().split('T')[0], source: '',
      assigned_shop_id: '', assigned_to: '', notes: '',
    },
  })

  useEffect(() => {
    if (existing) {
      reset(Object.fromEntries(FIELDS.map(f => [f, existing[f] ?? ''])))
    }
  }, [existing, reset])

  const shopChoice = watch('assigned_shop_id')
  useEffect(() => {
    if (shopChoice === '__new') { setNewShop(''); setValue('assigned_shop_id', '') }
  }, [shopChoice, setValue])

  async function addShop() {
    const name = (newShop || '').trim()
    if (!name) return
    const { data, error } = await supabase.from('shops').insert({ name }).select('id').single()
    if (error) { alert(error.message); return }
    await qc.invalidateQueries({ queryKey: ['shops'] })
    setValue('assigned_shop_id', data.id)
    setNewShop(null)
  }

  const mutation = useMutation({
    mutationFn: async (values) => {
      const payload = Object.fromEntries(FIELDS.map(f => [f, values[f] === '' ? null : values[f]]))
      payload.title = values.title
      if (isEditing) {
        const { error } = await supabase.from('pending_work').update(payload).eq('id', itemId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('pending_work').insert({ ...payload, vehicle_id: vehicleId })
        if (error) throw error
      }
    },
    onSuccess: () => {
      invalidatePending(qc, vehicleId)
      navigate(-1)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('pending_work').delete().eq('id', itemId)
      if (error) throw error
    },
    onSuccess: () => {
      invalidatePending(qc, vehicleId)
      navigate(`/vehicles/${vehicleId}?tab=pending`, { replace: true })
    },
  })

  const linkAction = useMutation({
    mutationFn: ({ fn }) => fn(),
    onSuccess: () => invalidatePending(qc, vehicleId),
  })

  const links    = existing?.pending_work_links || []
  const reporter = isEditing
    ? (existing?.reported_by && people[existing.reported_by]?.display_name)
    : profile?.display_name
  const sortedPeople = Object.values(people).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-bold">
          {isEditing ? 'Edit Pending Work Item' : 'Add Pending Work Item'}
        </h1>
        {reporter && <p className="text-primary-300 text-xs mt-0.5">Reported by {reporter}</p>}
      </div>

      <form onSubmit={handleSubmit(d => mutation.mutate(d))}
        className="p-4 space-y-4 max-w-lg mx-auto pb-10">
        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {mutation.error?.message || 'Something went wrong.'}
          </div>
        )}

        <div>
          <label className="field-label">Title *</label>
          <input {...register('title', { required: 'Title is required' })}
            placeholder="e.g. Rattle from rear left over bumps"
            className={`field-input ${errors.title ? 'border-red-400' : ''}`} />
          {errors.title && <p className="text-xs text-red-600 mt-0.5">{errors.title.message}</p>}
        </div>

        <div>
          <label className="field-label">Description</label>
          <textarea {...register('description')} rows={4}
            placeholder="What you noticed, when it happens, specs needed…"
            className="field-textarea" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Priority</label>
            <select {...register('priority')} className="field-select">
              {Object.entries(PRIORITY_META).map(([v, m]) => <option key={v} value={v}>{m.icon} {m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Status</label>
            <select {...register('status')} className="field-select">
              {Object.entries(STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* ── Who will do it ── */}
        <div className="card space-y-3">
          <h2 className="card-header mb-0">Who will do the work</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">Shop</label>
              {newShop === null ? (
                <select {...register('assigned_shop_id')} className="field-select">
                  <option value="">— not decided —</option>
                  {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="__new">+ Add a new shop…</option>
                </select>
              ) : (
                <div className="flex gap-1">
                  <input className="field-input" autoFocus placeholder="Shop name"
                    value={newShop} onChange={e => setNewShop(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addShop() } }} />
                  <button type="button" onClick={addShop} className="btn-primary text-xs px-2">Add</button>
                  <button type="button" onClick={() => setNewShop(null)} className="btn-secondary text-xs px-2"><X size={12} /></button>
                </div>
              )}
            </div>
            <div>
              <label className="field-label">Family member</label>
              <select {...register('assigned_to')} className="field-select">
                <option value="">— nobody yet —</option>
                {sortedPeople.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-400">e.g. Shop “NTB” + Ben taking it in, or Shop “Self / Owner” + whoever is doing it.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Estimated Cost</label>
            <input {...register('estimated_cost')} placeholder="~$250–350" className="field-input" />
          </div>
          <div>
            <label className="field-label">Identified Date</label>
            <input {...register('identified_date')} type="date" className="field-input" />
          </div>
        </div>

        <div>
          <label className="field-label">Source</label>
          <input {...register('source')}
            placeholder="e.g. NTB inspection, Autel scan, noticed while driving"
            className="field-input" />
        </div>

        <div>
          <label className="field-label">Notes</label>
          <textarea {...register('notes')} rows={3}
            placeholder="Additional context, follow-up steps…" className="field-textarea" />
        </div>

        {/* ── Work history ── */}
        {isEditing && (
          <div className="card space-y-2">
            <h2 className="card-header mb-0">Work history</h2>
            {links.length === 0 && (
              <p className="text-xs text-slate-400 italic">No service records linked yet.</p>
            )}
            {links.map(l => {
              const rec = l.service_records
              const to  = rec?.visit_id ? `/vehicles/${vehicleId}/visits/${rec.visit_id}/edit` : `/vehicles/${vehicleId}/service/${rec?.id}/edit`
              return (
                <div key={l.id} className="flex items-center gap-2 text-sm border-b border-slate-100 last:border-0 py-1.5">
                  {l.resolves
                    ? <CheckCircle2 size={14} className="text-green-600 shrink-0" />
                    : <CircleDashed size={14} className="text-blue-600 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <Link to={to} className="text-slate-800 hover:text-primary-700 truncate block">{rec?.title}</Link>
                    <span className="text-xs text-slate-500">
                      {rec?.service_date ? format(parseISO(rec.service_date), 'MMM d, yyyy') : 'no date'}
                      {rec?.service_visits?.shops?.name && ` · ${rec.service_visits.shops.name}`}
                    </span>
                  </div>
                  <button type="button" disabled={linkAction.isPending}
                    onClick={() => linkAction.mutate({ fn: () => setLinkResolves(l.id, !l.resolves) })}
                    className={l.resolves ? 'badge-green' : 'badge-blue'}
                    title="Tap to switch between resolved / worked on">
                    {l.resolves ? 'resolved' : 'worked on'}
                  </button>
                  <button type="button" disabled={linkAction.isPending} title="Unlink"
                    onClick={() => linkAction.mutate({ fn: () => unlink(l.id) })}
                    className="text-slate-300 hover:text-red-500 p-1"><X size={14} /></button>
                </div>
              )
            })}
            {linkAction.isError && <p className="text-xs text-red-600">{linkAction.error.message}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button"
                onClick={() => navigate(`/vehicles/${vehicleId}/add-visit`, { state: fromPendingState(existing) })}
                disabled={!existing}
                className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1">
                <FilePlus2 size={13} /> Log service visit
              </button>
              <button type="button" onClick={() => setLinking(true)} disabled={!existing}
                className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1">
                <Link2 size={13} /> Link existing record
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Item'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">Cancel</button>
          {isEditing && (
            <DeleteOrRequest table="pending_work" rowId={itemId} vehicleId={vehicleId}
              confirmText="Delete this pending work item? Its links to service records are removed too."
              onDelete={() => deleteMutation.mutate()} />
          )}
        </div>
      </form>

      {linking && existing && (
        <CompletePendingSheet item={existing} initialMode="link" onClose={() => setLinking(false)} />
      )}
    </div>
  )
}
