import { useState, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Camera, FileText, X, Sparkles, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react'

const DOC_TYPES = [
  { value: 'receipt',           label: '🧾 Receipt', canParse: true },
  { value: 'estimate',          label: '📋 Estimate / Quote', canParse: true },
  { value: 'inspection_report', label: '✅ Inspection Report', canParse: true },
  { value: 'registration',      label: '📄 Registration / Title', canParse: false },
  { value: 'photo',             label: '📷 Photo', canParse: false },
  { value: 'manual',            label: '📖 Manual / Guide', canParse: false },
  { value: 'other',             label: '📁 Other', canParse: false },
]

/** Supported MIME types for AI analysis */
const PARSEABLE_MIME = [
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
]

export default function UploadDocument() {
  const { id: vehicleIdParam } = useParams()
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const fileInputRef    = useRef(null)
  const cameraInputRef  = useRef(null)

  // When accessed from the fleet documents page (no vehicleId in route),
  // let the user pick a vehicle from a dropdown.
  const [pickedVehicleId, setPickedVehicleId] = useState('')
  const vehicleId = vehicleIdParam || pickedVehicleId

  const { data: vehicles } = useQuery({
    queryKey: ['vehicles_list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles').select('id, name, year, make, model').order('name')
      if (error) throw error
      return data
    },
    enabled: !vehicleIdParam,
  })

  // Derive the vehicle display name (for passing to the Edge Function)
  const vehicleMeta = vehicleIdParam
    ? null  // will be looked up from vehicle data on detail page
    : (vehicles || []).find(v => v.id === vehicleId)

  const [selectedFile, setSelectedFile]       = useState(null)
  const [preview, setPreview]                 = useState(null)
  const [uploadProgress, setUploadProgress]   = useState(null)

  // Post-upload state
  const [uploadedDoc, setUploadedDoc]         = useState(null)  // { id, docType, canParse }
  const [parseState, setParseState]           = useState('idle') // idle | loading | error
  const [parseError, setParseError]           = useState('')

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: { document_type: 'receipt' },
  })
  const watchedDocType = watch('document_type')
  const docTypeMeta    = DOC_TYPES.find(d => d.value === watchedDocType)

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = ev => setPreview(ev.target.result)
      reader.readAsDataURL(file)
    } else {
      setPreview(null)
    }
  }

  function clearFile() {
    setSelectedFile(null)
    setPreview(null)
    if (fileInputRef.current)   fileInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  const uploadMutation = useMutation({
    mutationFn: async (formValues) => {
      if (!selectedFile) throw new Error('Please select a file to upload.')
      setUploadProgress('Uploading file…')

      const safeName    = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `vehicles/${vehicleId}/${Date.now()}_${safeName}`

      const { error: storageError } = await supabase.storage
        .from('documents')
        .upload(storagePath, selectedFile, { cacheControl: '3600', upsert: false })
      if (storageError) throw new Error(`Upload failed: ${storageError.message}`)

      setUploadProgress('Saving record…')

      const { data: inserted, error: dbError } = await supabase
        .from('documents')
        .insert({
          vehicle_id:      vehicleId,
          document_type:   formValues.document_type,
          document_date:   formValues.document_date || null,
          filename:        selectedFile.name,
          storage_path:    storagePath,
          file_size_bytes: selectedFile.size,
          mime_type:       selectedFile.type,
          description:     formValues.description || null,
        })
        .select('id')
        .single()

      if (dbError) {
        await supabase.storage.from('documents').remove([storagePath])
        throw new Error(`Database error: ${dbError.message}`)
      }

      return { id: inserted.id, docType: formValues.document_type }
    },
    onSuccess: ({ id, docType }) => {
      setUploadProgress(null)
      qc.invalidateQueries({ queryKey: ['documents_all'] })
      qc.invalidateQueries({ queryKey: ['documents', vehicleId] })

      const meta     = DOC_TYPES.find(d => d.value === docType)
      const mimeOk   = PARSEABLE_MIME.includes(selectedFile?.type ?? '')
      const canParse = !!(meta?.canParse && mimeOk)

      setUploadedDoc({ id, docType, canParse })
    },
    onError: () => setUploadProgress(null),
  })

  async function handleAnalyze() {
    if (!uploadedDoc?.id) return
    setParseState('loading')
    setParseError('')

    try {
      // Resolve the vehicle name for a better Claude prompt
      let vehicleName = 'your vehicle'
      if (vehicleId) {
        const { data: veh } = await supabase
          .from('vehicles').select('name, year, make, model').eq('id', vehicleId).single()
        if (veh) vehicleName = veh.name || `${veh.year} ${veh.make} ${veh.model}`
      }

      const { data, error } = await supabase.functions.invoke('parse-document', {
        body: { documentId: uploadedDoc.id, vehicleName },
      })

      if (error) throw new Error(error.message || 'Edge Function error')
      if (!data?.success) throw new Error(data?.error || 'Parse failed')

      // Navigate to the visit form pre-populated with parsed data + document ID
      navigate(
        vehicleIdParam
          ? `/vehicles/${vehicleId}/add-visit`
          : `/vehicles/${vehicleId}/add-visit`,
        {
          state: {
            parsed:     data.data,
            documentId: uploadedDoc.id,
          },
        }
      )
    } catch (err) {
      setParseState('error')
      setParseError(err.message || 'Analysis failed. You can enter the details manually.')
    }
  }

  function handleDone() {
    navigate(vehicleIdParam ? `/vehicles/${vehicleId}?tab=visits` : '/documents')
  }

  const fileSizeMB = selectedFile ? (selectedFile.size / 1024 / 1024).toFixed(1) : null

  // ── Post-upload success screen ────────────────────────────────────────────
  if (uploadedDoc) {
    return (
      <div className="flex flex-col min-h-full">
        <div className="bg-primary-900 text-white px-4 py-4">
          <h1 className="text-xl font-bold">Document Uploaded</h1>
          <p className="text-primary-300 text-sm mt-0.5">{selectedFile?.name}</p>
        </div>

        <div className="p-6 max-w-lg mx-auto w-full space-y-4">
          {/* Success banner */}
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
            <CheckCircle2 size={22} className="text-green-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">File saved successfully</p>
              <p className="text-xs text-green-600 mt-0.5">
                {DOC_TYPES.find(d => d.value === uploadedDoc.docType)?.label} · stored in Documents
              </p>
            </div>
          </div>

          {/* AI analysis option */}
          {uploadedDoc.canParse && parseState !== 'error' && (
            <div className="card space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-amber-500" />
                <h2 className="text-sm font-semibold text-slate-700">Analyze with AI</h2>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Claude can read this document and automatically create a service visit with all
                line items and parts. You'll review everything before it's saved.
              </p>
              <button
                onClick={handleAnalyze}
                disabled={parseState === 'loading'}
                className="w-full flex items-center justify-between bg-amber-500 hover:bg-amber-400
                           disabled:opacity-60 text-white font-semibold text-sm px-4 py-3 rounded-lg
                           transition-colors"
              >
                <span className="flex items-center gap-2">
                  {parseState === 'loading'
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Analyzing…</>
                    : <><Sparkles size={15} /> Extract Service Records</>
                  }
                </span>
                {parseState !== 'loading' && <ChevronRight size={16} />}
              </button>
            </div>
          )}

          {/* Parse error */}
          {parseState === 'error' && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">Analysis failed</p>
                <p className="text-xs text-red-600 mt-0.5">{parseError}</p>
                <button
                  onClick={() => { setParseState('idle'); setParseError('') }}
                  className="text-xs text-red-700 underline mt-1"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Manual entry option */}
          <button
            onClick={() => navigate(
              vehicleIdParam ? `/vehicles/${vehicleId}/add-visit` : `/vehicles/${vehicleId}/add-visit`
            )}
            className="w-full flex items-center justify-between btn-secondary px-4 py-3 text-sm"
          >
            <span>Enter service records manually</span>
            <ChevronRight size={16} className="text-slate-400" />
          </button>

          {/* Done / skip */}
          <button onClick={handleDone} className="w-full text-sm text-slate-400 hover:text-slate-600 py-2">
            Done — no service records needed
          </button>
        </div>
      </div>
    )
  }

  // ── Upload form ───────────────────────────────────────────────────────────
  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-bold">Upload Document</h1>
        <p className="text-primary-300 text-sm mt-0.5">
          Receipts, estimates, inspection reports, photos
        </p>
      </div>

      <form
        onSubmit={handleSubmit(d => uploadMutation.mutate(d))}
        className="p-4 space-y-4 max-w-lg mx-auto pb-10"
      >
        {uploadMutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {uploadMutation.error?.message || 'Something went wrong.'}
          </div>
        )}

        {/* Vehicle picker — only when accessed from fleet docs page */}
        {!vehicleIdParam && (
          <div className="card space-y-2">
            <h2 className="card-header">Vehicle</h2>
            <select
              value={pickedVehicleId}
              onChange={e => setPickedVehicleId(e.target.value)}
              className="field-select"
            >
              <option value="">— Select a vehicle —</option>
              {(vehicles || []).map(v => (
                <option key={v.id} value={v.id}>
                  {v.name || `${v.year} ${v.make} ${v.model}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* File picker */}
        <div className="card space-y-3">
          <h2 className="card-header">File</h2>

          {!selectedFile ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 border-2 border-dashed
                           border-primary-300 rounded-lg py-6 text-primary-600 hover:border-primary-500
                           hover:bg-primary-50 transition-colors text-sm font-medium"
              >
                <Camera size={20} /> Take Photo / Scan
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 border border-slate-200
                           rounded-lg py-3 text-slate-600 hover:bg-slate-50 transition-colors text-sm"
              >
                <FileText size={16} /> Choose File from Device
              </button>
              <p className="text-xs text-slate-400 text-center">PDF, JPEG, PNG, HEIC · Max 50 MB</p>
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
                     className="hidden" onChange={handleFileChange} />
              <input ref={fileInputRef} type="file"
                     accept="image/*,application/pdf,.heic,.heif"
                     className="hidden" onChange={handleFileChange} />
            </div>
          ) : (
            <div className="space-y-2">
              {preview ? (
                <div className="relative">
                  <img src={preview} alt="Preview"
                       className="w-full max-h-48 object-contain rounded-lg bg-slate-50" />
                  <button type="button" onClick={clearFile}
                          className="absolute top-2 right-2 bg-white rounded-full p-1 shadow-md text-slate-600 hover:text-red-600">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <FileText size={18} className="text-slate-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-700 truncate max-w-[200px]">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-slate-400">{fileSizeMB} MB</p>
                    </div>
                  </div>
                  <button type="button" onClick={clearFile}
                          className="text-slate-400 hover:text-red-600"><X size={16} /></button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="card space-y-3">
          <h2 className="card-header">Details</h2>
          <div>
            <label className="field-label">Document Type</label>
            <select {...register('document_type')} className="field-select">
              {DOC_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            {docTypeMeta?.canParse && selectedFile && PARSEABLE_MIME.includes(selectedFile.type) && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <Sparkles size={11} /> AI analysis available for this document type after upload.
              </p>
            )}
          </div>
          <div>
            <label className="field-label">Document Date</label>
            <input {...register('document_date')} type="date" className="field-input" />
            <p className="text-xs text-slate-400 mt-0.5">
              Date of the receipt or document (not today's upload date)
            </p>
          </div>
          <div>
            <label className="field-label">Description</label>
            <textarea
              {...register('description')}
              rows={3}
              placeholder="e.g. NTB receipt — AC compressor + brake job, 2004 Suburban"
              className="field-textarea"
            />
          </div>
        </div>

        {uploadProgress && (
          <div className="flex items-center gap-2 text-primary-600 text-sm animate-pulse">
            <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
            {uploadProgress}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={uploadMutation.isPending || !selectedFile || !vehicleId}
            className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadMutation.isPending ? 'Uploading…' : 'Upload Document'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
