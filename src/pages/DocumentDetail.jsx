/**
 * DocumentDetail — view, edit, re-parse, and delete a single document.
 *
 * Route: /documents/:docId
 *
 * Features:
 *   • View / edit document metadata (filename, type, date, description)
 *   • Open / download the original file
 *   • Re-parse with AI → navigate to add-visit pre-populated
 *   • See all service visits that were created from this document
 *   • Delete document (removes DB record + storage file)
 *   • 9.7: the vehicle it's filed under (or General) and, for manuals and
 *     references, the other vehicles it also covers
 */

import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { supabase } from '@/lib/supabase'
import { useVehicleChoices } from '@/lib/mechanic'
import { REFERENCE_TYPES, FILED_UNDER, setAlsoCovers, invalidateDocuments } from '@/lib/documents'
import AlsoCoversPicker from '@/components/AlsoCoversPicker'
import DeleteOrRequest from '@/components/DeleteOrRequest'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, Download, Sparkles, Trash2, Save, ExternalLink } from 'lucide-react'

const DOC_TYPES = [
  'receipt', 'estimate', 'inspection_report', 'registration', 'photo', 'manual', 'other',
]

const PARSEABLE_TYPES  = new Set(['receipt', 'estimate', 'inspection_report'])
const PARSEABLE_MIMES  = new Set(['application/pdf','image/jpeg','image/png','image/gif','image/webp'])

export default function DocumentDetail() {
  const { docId }  = useParams()
  const navigate   = useNavigate()
  const qc         = useQueryClient()

  const [analyzing,  setAnalyzing]  = useState(false)
  const [analyzeErr, setAnalyzeErr] = useState('')
  const [editMode,   setEditMode]   = useState(false)
  const [alsoCovers, setAlsoCoversIds] = useState([])
  const { data: vehicles = [] } = useVehicleChoices()

  // ── Load document ─────────────────────────────────────────────────────────
  const { data: doc, isLoading } = useQuery({
    queryKey: ['document', docId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select(`*, ${FILED_UNDER}(id, name, year, make, model), document_vehicles(vehicle_id, vehicles(name))`)
        .eq('id', docId)
        .single()
      if (error) throw error
      return data
    },
  })
  const coveredIds = (doc?.document_vehicles ?? []).map(l => l.vehicle_id)

  // ── Load linked service visits ────────────────────────────────────────────
  const { data: linkedVisits = [] } = useQuery({
    queryKey: ['linked_visits', docId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_visits')
        .select(`
          id, visit_date, visit_type, total_cost,
          shops(name),
          service_records(id, title, category)
        `)
        .eq('source_document_id', docId)
        .order('visit_date', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!docId,
  })

  // ── Edit form ─────────────────────────────────────────────────────────────
  const { register, handleSubmit, reset, watch } = useForm()
  const editType    = watch('document_type')
  const editVehicle = watch('vehicle_id')
  const editIsRef   = REFERENCE_TYPES.has(editType)

  function startEdit() {
    reset({
      filename:      doc.filename      || '',
      document_type: doc.document_type || 'other',
      document_date: doc.document_date || '',
      description:   doc.description  || '',
      vehicle_id:    doc.vehicle_id    || '',   // '' = General (all vehicles)
    })
    setAlsoCoversIds(coveredIds)
    setEditMode(true)
  }

  const saveMutation = useMutation({
    mutationFn: async (values) => {
      const isRef = REFERENCE_TYPES.has(values.document_type)
      if (!values.vehicle_id && !isRef) throw new Error('Receipts and records need a vehicle; only manuals and references can be General.')
      const { error } = await supabase
        .from('documents')
        .update({
          filename:      values.filename      || null,
          document_type: values.document_type || null,
          document_date: values.document_date || null,
          description:   values.description  || null,
          vehicle_id:    values.vehicle_id    || null,
        })
        .eq('id', docId)
      if (error) throw error
      // Only a vehicle-filed reference covers others; General already covers every vehicle
      const keep = isRef && values.vehicle_id ? alsoCovers.filter(v => v !== values.vehicle_id) : []
      await setAlsoCovers(docId, keep, coveredIds)
    },
    onSuccess: () => {
      invalidateDocuments(qc, docId)
      setEditMode(false)
    },
  })

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Delete from storage first
      if (doc.storage_path) {
        await supabase.storage.from('documents').remove([doc.storage_path])
      }
      const { error } = await supabase.from('documents').delete().eq('id', docId)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateDocuments(qc)
      navigate('/documents')
    },
  })

  // ── Open file ─────────────────────────────────────────────────────────────
  async function openFile() {
    const { data } = await supabase.storage
      .from('documents').createSignedUrl(doc.storage_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // ── AI re-parse ───────────────────────────────────────────────────────────
  async function handleAnalyze() {
    setAnalyzing(true)
    setAnalyzeErr('')
    try {
      const vehicleId   = doc.vehicle_id
      const vehicleName = doc.vehicles
        ? `${doc.vehicles.year} ${doc.vehicles.make} ${doc.vehicles.model}`
        : 'unknown vehicle'

      const { data: result, error } = await supabase.functions.invoke('parse-document', {
        body: { documentId: docId, vehicleName },
      })

      if (error) {
        let detail = error.message || 'Edge Function error'
        try {
          const body = await error.context?.json?.()
          if (body?.error) detail = body.error
          if (body?.detail) detail += ' — ' + body.detail
        } catch { /* ignore */ }
        setAnalyzeErr(detail)
        return
      }
      if (!result?.success) {
        setAnalyzeErr(result?.error || 'Analysis failed.')
        return
      }

      navigate(`/vehicles/${vehicleId}/add-visit`, {
        state: { parsed: result.data, documentId: docId },
      })
    } catch (e) {
      setAnalyzeErr(String(e))
    } finally {
      setAnalyzing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div className="p-4 text-slate-400 text-sm animate-pulse">Loading…</div>
  }
  if (!doc) {
    return <div className="p-4 text-red-500 text-sm">Document not found.</div>
  }

  const canParse = PARSEABLE_TYPES.has(doc.document_type) &&
                   PARSEABLE_MIMES.has(doc.mime_type)

  return (
    <div>
      {/* Header */}
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-lg font-bold truncate">{doc.filename}</h1>
        <p className="text-primary-300 text-xs mt-0.5">
          {doc.vehicle_id ? doc.vehicles?.name : 'General (all vehicles)'}
          {doc.document_date ? ` · ${format(parseISO(doc.document_date), 'MMM d, yyyy')}` : ''}
        </p>
      </div>

      <div className="p-4 space-y-5 max-w-2xl mx-auto pb-10">

        {/* ── Action bar ── */}
        <div className="flex flex-wrap gap-2">
          <button onClick={openFile}
            className="btn-secondary flex items-center gap-1.5 text-sm py-2 px-3">
            <Download size={14} /> Open File
          </button>

          {canParse && (
            <button onClick={handleAnalyze} disabled={analyzing}
              className="flex items-center gap-1.5 text-sm py-2 px-3 rounded-lg font-medium
                         bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-60 transition-colors">
              <Sparkles size={14} />
              {analyzing ? 'Analyzing…' : 'Extract Service Records (AI)'}
            </button>
          )}

          {!editMode && (
            <button onClick={startEdit}
              className="btn-secondary flex items-center gap-1.5 text-sm py-2 px-3">
              Edit Metadata
            </button>
          )}

          <span className="ml-auto">
            <DeleteOrRequest
              table="documents" rowId={docId} vehicleId={doc?.vehicle_id}
              confirmText="Delete this document? The file will be permanently removed."
              onDelete={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-1.5 text-sm py-2 px-3 rounded-lg font-medium
                         bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors"
            >
              <Trash2 size={14} />
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </DeleteOrRequest>
          </span>
        </div>

        {analyzeErr && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
            Analysis failed: {analyzeErr}
          </div>
        )}

        {deleteMutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
            {deleteMutation.error?.message}
          </div>
        )}

        {/* ── Metadata (view or edit) ── */}
        {editMode ? (
          <form onSubmit={handleSubmit(d => saveMutation.mutate(d))}
                className="card space-y-3">
            <h2 className="card-header">Edit Metadata</h2>

            <div>
              <label className="field-label">Filename</label>
              <input type="text" className="field-input" {...register('filename')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">Document Type</label>
                <select className="field-select" {...register('document_type')}>
                  {DOC_TYPES.map(t => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Document Date</label>
                <input type="date" className="field-input" {...register('document_date')} />
              </div>
            </div>

            <div>
              <label className="field-label">Filed under</label>
              <select className="field-select" {...register('vehicle_id')}>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                {(editIsRef || !editVehicle) && <option value="">General (all vehicles)</option>}
              </select>
            </div>
            {editIsRef && editVehicle && (
              <AlsoCoversPicker vehicles={vehicles} filedUnder={editVehicle}
                value={alsoCovers} onChange={setAlsoCoversIds} />
            )}

            <div>
              <label className="field-label">Description</label>
              <textarea className="field-textarea" rows={3} {...register('description')} />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saveMutation.isPending}
                className="btn-primary flex items-center gap-1.5 py-2 px-4 text-sm">
                <Save size={13} /> {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
              </button>
              <button type="button" onClick={() => setEditMode(false)} className="btn-secondary py-2 px-4 text-sm">
                Cancel
              </button>
            </div>
            {saveMutation.isError && <p className="text-sm text-red-600">{saveMutation.error?.message}</p>}
          </form>
        ) : (
          <div className="card space-y-2">
            <h2 className="card-header">Document Info</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-400">Filed under</dt>
                <dd className="font-medium text-slate-700">
                  {doc.vehicle_id ? (doc.vehicles?.name || '—') : 'General (all vehicles)'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Type</dt>
                <dd className="font-medium text-slate-700">{doc.document_type?.replace(/_/g, ' ') || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Date</dt>
                <dd className="font-medium text-slate-700">
                  {doc.document_date ? format(parseISO(doc.document_date), 'MMM d, yyyy') : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">File Type</dt>
                <dd className="font-medium text-slate-700">{doc.mime_type || '—'}</dd>
              </div>
              {coveredIds.length > 0 && (
                <div className="col-span-2">
                  <dt className="text-xs text-slate-400">Also covers</dt>
                  <dd className="font-medium text-slate-700">
                    {doc.document_vehicles.map(l => l.vehicles?.name).filter(Boolean).join(', ')}
                  </dd>
                </div>
              )}
              {doc.description && (
                <div className="col-span-2">
                  <dt className="text-xs text-slate-400">Description</dt>
                  <dd className="text-slate-700">{doc.description}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* ── Linked service visits ── */}
        <div className="card space-y-3">
          <h2 className="card-header">Linked Service Visits</h2>
          {linkedVisits.length === 0 ? (
            <p className="text-sm text-slate-400">
              No service visits have been linked to this document yet.
              {canParse && ' Use "Extract Service Records" above to create one from this document.'}
            </p>
          ) : (
            <div className="space-y-2">
              {linkedVisits.map(v => (
                <Link
                  key={v.id}
                  to={`/vehicles/${doc.vehicle_id}/visits/${v.id}/edit`}
                  className="block border border-slate-200 rounded-lg px-3 py-2.5 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700">
                        {v.visit_date ? format(parseISO(v.visit_date), 'MMM d, yyyy') : 'Unknown date'}
                        {v.shops?.name ? ` · ${v.shops.name}` : ''}
                      </p>
                      {(v.service_records || []).length > 0 && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          {v.service_records.map(r => r.title).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {v.total_cost != null && (
                        <span className="text-sm font-medium text-slate-600">
                          ${Number(v.total_cost).toFixed(2)}
                        </span>
                      )}
                      <ExternalLink size={13} className="text-primary-400" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
