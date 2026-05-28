import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { format, parseISO } from 'date-fns'
import { FileText, Download, Upload } from 'lucide-react'

const DOC_ICONS = {
  receipt: '🧾', estimate: '📋', inspection_report: '✅',
  registration: '📄', photo: '📷', manual: '📖', other: '📁',
}

export default function DocumentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['documents_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*, vehicles(name, year, make, model)')
        .order('document_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  async function getDownloadUrl(storagePath) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(storagePath, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">Documents</h1>
            <p className="text-primary-300 text-sm mt-0.5">
              Receipts, estimates, inspection reports, photos
            </p>
          </div>
          <Link
            to="/documents/upload"
            className="flex items-center gap-1.5 bg-primary-700 hover:bg-primary-600
                       text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            <Upload size={14} /> Upload
          </Link>
        </div>
      </div>

      <div className="p-4 space-y-3 max-w-2xl mx-auto">
        {isLoading && <p className="text-slate-400 text-sm animate-pulse">Loading…</p>}

        {(data || []).length === 0 && !isLoading && (
          <p className="text-center text-slate-400 text-sm py-12">
            No documents uploaded yet. Use the Upload button above to add receipts, photos, and reports.
          </p>
        )}

        {(data || []).map(doc => (
          <div key={doc.id} className="card flex items-start gap-3">
            <span className="text-2xl flex-shrink-0 mt-0.5">
              {DOC_ICONS[doc.document_type] || '📁'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-slate-800 truncate">{doc.filename}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {doc.vehicles?.name}
                {doc.document_date ? ` · ${format(parseISO(doc.document_date), 'MMM d, yyyy')}` : ''}
                {doc.document_type ? ` · ${doc.document_type.replace(/_/g, ' ')}` : ''}
              </p>
              {doc.description && (
                <p className="text-xs text-slate-600 mt-1 line-clamp-2">{doc.description}</p>
              )}
            </div>
            <button
              onClick={() => getDownloadUrl(doc.storage_path)}
              className="flex-shrink-0 text-primary-600 hover:text-primary-800 p-1"
              title="Open document"
            >
              <Download size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
