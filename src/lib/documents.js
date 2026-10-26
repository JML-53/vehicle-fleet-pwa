/**
 * Documents (item 9; 9.7 reference library): which documents belong to a
 * vehicle, shared reference documents, and labels for the documents screens.
 *
 * A document is filed under one vehicle (documents.vehicle_id), or under none
 * = General (all vehicles), e.g. a scan-tool manual. A reference document can
 * also cover other vehicles (document_vehicles). A vehicle's documents are the
 * ones filed under it, the ones that also cover it, and the General ones.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const DOC_ICONS = {
  receipt: '🧾', estimate: '📋', inspection_report: '✅',
  registration: '📄', photo: '📷', manual: '📖', other: '📁',
}

/** Reference material: can be General or cover several vehicles. The other types are one vehicle's records. */
export const REFERENCE_TYPES = new Set(['manual', 'other'])
export const isReference = doc => REFERENCE_TYPES.has(doc.document_type)

// documents ↔ vehicles has two paths now (vehicle_id, and document_vehicles), so
// PostgREST needs the foreign key named: filed-under vehicle = documents_vehicle_id_fkey
export const FILED_UNDER = 'vehicles!documents_vehicle_id_fkey'
export const DOC_FIELDS =
  `id, filename, document_type, document_date, description, mime_type, vehicle_id, ${FILED_UNDER}(name), document_vehicles(vehicle_id)`

/** Filed under the vehicle, also covering it, or General */
export function coversVehicle(doc, vehicleId) {
  return doc.vehicle_id === vehicleId || doc.vehicle_id == null
    || (doc.document_vehicles ?? []).some(l => l.vehicle_id === vehicleId)
}

/** Where a document is filed, for list rows: "General (all vehicles)", "R2", "R2 + 1 more" */
export function filedLabel(doc) {
  if (doc.vehicle_id == null) return 'General (all vehicles)'
  const more = (doc.document_vehicles ?? []).length
  return `${doc.vehicles?.name ?? 'Unknown vehicle'}${more ? ` + ${more} more` : ''}`
}

export function useVehicleDocuments(vehicleId) {
  return useQuery({
    queryKey: ['documents', vehicleId],
    queryFn: async () => {
      const { data: links, error: linkErr } = await supabase
        .from('document_vehicles').select('document_id').eq('vehicle_id', vehicleId)
      if (linkErr) throw linkErr
      const covers = [`vehicle_id.eq.${vehicleId}`, 'vehicle_id.is.null']
      if (links.length) covers.push(`id.in.(${links.map(l => l.document_id).join(',')})`)
      const { data, error } = await supabase
        .from('documents').select(DOC_FIELDS).or(covers.join(','))
        .order('document_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data
    },
    enabled: !!vehicleId,
  })
}

/** Save the other vehicles a document also covers: adds and removes links */
export async function setAlsoCovers(docId, vehicleIds, current = []) {
  const add    = vehicleIds.filter(v => !current.includes(v))
  const remove = current.filter(v => !vehicleIds.includes(v))
  if (add.length) {
    const { error } = await supabase.from('document_vehicles')
      .insert(add.map(vehicle_id => ({ document_id: docId, vehicle_id })))
    if (error) throw error
  }
  if (remove.length) {
    const { error } = await supabase.from('document_vehicles')
      .delete().eq('document_id', docId).in('vehicle_id', remove)
    if (error) throw error
  }
}

/** Shared and General documents show on several vehicles, so refresh every vehicle's list */
export function invalidateDocuments(qc, docId) {
  qc.invalidateQueries({ queryKey: ['documents'] })
  qc.invalidateQueries({ queryKey: ['documents_all'] })
  if (docId) qc.invalidateQueries({ queryKey: ['document', docId] })
}
