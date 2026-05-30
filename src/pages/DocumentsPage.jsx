import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { format, parseISO } from 'date-fns'
import { Upload, ChevronRight } from 'lucide-react'

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
        .select(`
          id, filename, document_type, document_date, description, mime_type,
          vehicles(name),
          service_visits!service_visits_source_document_id_fkey(id)
        `)
        .order('document_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data
    },
  })

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

        {(data || []).map(doc => {
          const linkedCount = (doc.service_visits || []).length
          return (
            <Link
              key={doc.id}
              to={`/documents/${doc.id}`}
              className="card flex items-center gap-3 hover:bg-slate-50 transition-colors no-underline"
            >
              <span className="text-2xl flex-shrink-0">
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
                  <p className="text-xs text-slate-600 mt-1 line-clamp-1">{doc.description}</p>
                )}
                {linkedCount > 0 && (
                  <p className="text-xs text-primary-600 font-medium mt-1">
                    {linkedCount} linked visit{linkedCount !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
