/**
 * DocumentsPage — every document in the fleet. Route: /documents
 *
 * Item 9.7: filter by vehicle (a vehicle's documents include the shared and
 * General ones that cover it) and by kind (manuals & references, or receipts
 * & records). Choices are remembered in this browser, like Guides.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useStoredState } from '@/lib/useStoredState'
import { useVehicleChoices } from '@/lib/mechanic'
import { DOC_FIELDS, coversVehicle, isReference } from '@/lib/documents'
import DocumentRow from '@/components/DocumentRow'

const darkSelect = 'bg-primary-800 text-primary-100 text-xs rounded-full px-3 py-1 border-0 focus:ring-2 focus:ring-primary-400'

export default function DocumentsPage() {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['documents_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select(`${DOC_FIELDS}, service_visits!service_visits_source_document_id_fkey(id)`)
        .order('document_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data
    },
  })
  const { data: vehicles = [] } = useVehicleChoices()
  const [vehicle, setVehicle] = useStoredState('documents_vehicle_filter', 'all')   // all | general | <vehicle uuid>
  const [kind, setKind]       = useStoredState('documents_kind_filter', 'all')      // all | reference | record

  const shown = useMemo(() => data.filter(doc =>
    (vehicle === 'all' || (vehicle === 'general' ? doc.vehicle_id == null : coversVehicle(doc, vehicle)))
    && (kind === 'all' || (kind === 'reference') === isReference(doc))
  ), [data, vehicle, kind])

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">Documents</h1>
            <p className="text-primary-300 text-sm mt-0.5">
              Manuals, receipts, estimates, inspection reports, photos
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

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <div className="inline-flex rounded-full bg-primary-800 p-0.5" role="group" aria-label="Kind">
            {[['all', 'All'], ['reference', 'Manuals & references'], ['record', 'Receipts & records']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`px-3 py-0.5 rounded-full text-xs font-medium ${
                  kind === k ? 'bg-white text-primary-900' : 'text-primary-100 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
          <select aria-label="Vehicle" value={vehicle} onChange={e => setVehicle(e.target.value)} className={darkSelect}>
            <option value="all">All vehicles</option>
            <option value="general">General (all vehicles)</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
      </div>

      <div className="p-4 space-y-3 max-w-2xl mx-auto">
        {isLoading && <p className="text-slate-400 text-sm animate-pulse">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error.message}</p>}

        {!isLoading && !error && shown.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-12">
            {data.length
              ? 'No documents match these filters.'
              : 'No documents uploaded yet. Use the Upload button above to add manuals, receipts, photos, and reports.'}
          </p>
        )}

        {shown.map(doc => (
          <DocumentRow key={doc.id} doc={doc} linkedVisits={(doc.service_visits || []).length} />
        ))}
      </div>
    </div>
  )
}
