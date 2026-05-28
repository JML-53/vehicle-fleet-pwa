import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Camera, FileText, X } from 'lucide-react'

const DOC_TYPES = [
  { value: 'receipt',           label: '🧾 Receipt' },
  { value: 'estimate',          label: '📋 Estimate / Quote' },
  { value: 'inspection_report', label: '✅ Inspection Report' },
  { value: 'registration',      label: '📄 Registration / Title' },
  { value: 'photo',             label: '📷 Photo' },
  { value: 'manual',            label: '📖 Manual / Guide' },
  { value: 'other',             label: '📁 Other' },
]

export default function UploadDocument() {
  const { id: vehicleIdParam } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  // When accessed from the fleet documents page (no vehicleId in route),
  // let the user pick a vehicle from a dropdown.
  const [pickedVehicleId, setPickedVehicleId] = useState('')
  const vehicleId = vehicleIdParam || pickedVehicleId

  const { data: vehicles } = useQuery({
    queryKey: ['vehicles_list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, name, year, make, model')
        .order('name')
      if (error) throw error
      return data
    },
    enabled: !vehicleIdParam, // only fetch when we need the picker
  })

  const [selectedFile, setSelectedFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(null)

  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { document_type: 'receipt' },
  })

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)

    // Show image preview if it's an image
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
    if (fileInputRef.current)    fileInputRef.current.value = ''
    if (cameraInputRef.current)  cameraInputRef.current.value = ''
  }

  const mutation = useMutation({
    mutationFn: async (formValues) => {
      if (!selectedFile) throw new Error('Please select a file to upload.')

      setUploadProgress('Uploading file…')

      // Build a unique storage path: vehicles/{vehicleId}/{timestamp}_{filename}
      const ext       = selectedFile.name.split('.').pop()
      const safeName  = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const timestamp = Date.now()
      const storagePath = `vehicles/${vehicleId}/${timestamp}_${safeName}`

      // Upload to Supabase Storage
      const { error: storageError } = await supabase.storage
        .from('documents')
        .upload(storagePath, selectedFile, { cacheControl: '3600', upsert: false })

      if (storageError) throw new Error(`Upload failed: ${storageError.message}`)

      setUploadProgress('Saving record…')

      // Insert row into documents table
      const { error: dbError } = await supabase.from('documents').insert({
        vehicle_id:     vehicleId,
        document_type:  formValues.document_type,
        document_date:  formValues.document_date || null,
        filename:       selectedFile.name,
        storage_path:   storagePath,
        file_size_bytes: selectedFile.size,
        mime_type:      selectedFile.type,
        description:    formValues.description || null,
      })

      if (dbError) {
        // Try to clean up the uploaded file if the DB insert fails
        await supabase.storage.from('documents').remove([storagePath])
        throw new Error(`Database error: ${dbError.message}`)
      }
    },
    onSuccess: () => {
      setUploadProgress(null)
      qc.invalidateQueries({ queryKey: ['documents_all'] })
      qc.invalidateQueries({ queryKey: ['documents', vehicleId] })
      // If we came from the fleet docs page (no vehicleId param), go back there
      navigate(vehicleIdParam ? -1 : '/documents')
    },
    onError: () => setUploadProgress(null),
  })

  const fileSizeMB = selectedFile ? (selectedFile.size / 1024 / 1024).toFixed(1) : null

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
        onSubmit={handleSubmit(d => mutation.mutate(d))}
        className="p-4 space-y-4 max-w-lg mx-auto pb-10"
      >
        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {mutation.error?.message || 'Something went wrong.'}
          </div>
        )}

        {/* Vehicle picker — only shown when accessed from the fleet documents page */}
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
              {/* Camera button — primary on mobile */}
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

              <p className="text-xs text-slate-400 text-center">
                PDF, JPEG, PNG, HEIC · Max 50 MB
              </p>

              {/* Hidden inputs */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,.heic,.heif"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          ) : (
            <div className="space-y-2">
              {/* Preview */}
              {preview ? (
                <div className="relative">
                  <img
                    src={preview}
                    alt="Preview"
                    className="w-full max-h-48 object-contain rounded-lg bg-slate-50"
                  />
                  <button
                    type="button"
                    onClick={clearFile}
                    className="absolute top-2 right-2 bg-white rounded-full p-1 shadow-md
                               text-slate-600 hover:text-red-600"
                  >
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
                  <button
                    type="button"
                    onClick={clearFile}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              <p className="text-xs text-slate-500 text-center">
                {selectedFile.name} · {fileSizeMB} MB
              </p>
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
          </div>

          <div>
            <label className="field-label">Document Date</label>
            <input {...register('document_date')} type="date" className="field-input" />
            <p className="text-xs text-slate-400 mt-0.5">
              Date of the receipt, inspection, or document (not today's upload date)
            </p>
          </div>

          <div>
            <label className="field-label">Description</label>
            <textarea
              {...register('description')}
              rows={3}
              placeholder="e.g. NTB receipt — AC compressor + brake job, 04 Suburban"
              className="field-textarea"
            />
          </div>
        </div>

        {/* Upload progress */}
        {uploadProgress && (
          <div className="flex items-center gap-2 text-primary-600 text-sm animate-pulse">
            <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
            {uploadProgress}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending || !selectedFile || !vehicleId}
            className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Uploading…' : 'Upload Document'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
