/**
 * documentImport — save an uploaded document and act on what the AI found in it
 * (items 9, 9.3, 9.4, 9.5). Used by the review screen (AddEditServiceVisit in
 * review mode). Everything here runs only after the user has reviewed it.
 *
 * Every row created links back to the source document (9.5):
 *   service_visits.source_document_id · inspection_fulfillments.document_id ·
 *   diagnostic_codes.document_id · pending_work.source_document_id
 */
import { supabase } from '@/lib/supabase'
import { calcDueDate, ensureInspectionTemplate } from '@/lib/inspections'
import { createInspectionRepairItems, rankPendingItems } from '@/lib/pendingWork'

/** Score at/above which recommended work is treated as already tracked */
export const ALREADY_TRACKED = 2

/** Insert the documents row for a file uploaded before review → id */
export async function saveUploadedDocument({ upload, vehicleId, documentType, documentDate, description, serviceRecordId }) {
  const { data, error } = await supabase.from('documents').insert({
    vehicle_id:        vehicleId,
    document_type:     documentType || 'other',
    document_date:     documentDate || null,
    description:       description || null,
    filename:          upload.filename,
    storage_path:      upload.storagePath,
    mime_type:         upload.mimeType,
    file_size_bytes:   upload.size ?? null,
    service_record_id: serviceRecordId ?? null,
  }).select('id').single()
  if (error) throw error
  return data.id
}

/**
 * Default selection for the "Also found" panel: everything ticked, except
 * recommended work that already matches an open pending item.
 */
export function defaultFindings(parsed, openPending = []) {
  const work = (parsed?.recommended_work || []).map(w => {
    const best = rankPendingItems({ title: w.title }, openPending)[0]
    const match = best && best.score >= ALREADY_TRACKED ? best : null
    return { ...w, include: !match, match: match ? { id: match.id, title: match.title } : null }
  })
  return {
    inspection: parsed?.inspection
      ? { ...parsed.inspection, include: true, repairs: parsed.inspection.repairs_needed || '' }
      : null,
    codes: (parsed?.diagnostic_codes || []).map(c => ({ ...c, include: true })),
    work,
  }
}

/**
 * Create the ticked findings.
 * recordIdByIndex: parsed record index → saved service_record id
 */
export async function applyFindings({ findings, vehicleId, documentId, visitDate, shopId, mileage, recordIdByIndex = {}, diagnosticRecordId = null }) {
  const created = { inspection: null, repairItems: [], codes: 0, work: 0 }
  if (!findings) return created

  // ── Inspection (9.3): attach to the parsed record — one event, one record ──
  const insp = findings.inspection
  if (insp?.include && insp.inspection_type && insp.result) {
    const date     = insp.inspection_date || visitDate
    const template = await ensureInspectionTemplate(vehicleId, insp.inspection_type)
    const { data: inf, error } = await supabase.from('inspection_fulfillments').insert({
      inspection_id:         template.id,
      service_record_id:     insp.record_index != null ? recordIdByIndex[insp.record_index] ?? null : null,
      inspection_date:       date,
      expiry_date:           calcDueDate(date, insp.inspection_type, insp.result, template.grace_days) || null,
      result:                insp.result,
      report_number:         insp.report_number || null,
      shop_id:               shopId || null,
      document_id:           documentId,
      mileage_at_inspection: mileage ?? null,
      notes:                 insp.repairs || null,
    }).select('id').single()
    if (error) throw error
    created.inspection = inf.id

    if (insp.result === 'fail') {
      created.repairItems = await createInspectionRepairItems({
        vehicleId, fulfillmentId: inf.id, inspectionType: insp.inspection_type,
        inspectionDate: date, repairs: insp.repairs, shopId, documentId,
      })
    }
  }

  // ── Trouble codes (9.4) ──────────────────────────────────────────────────────
  const codes = (findings.codes || []).filter(c => c.include && c.code?.trim())
  if (codes.length) {
    // Linked to the visit's diagnostic line item when there is one
    const { error } = await supabase.from('diagnostic_codes').insert(codes.map(c => ({
      vehicle_id:        vehicleId,
      code:              c.code.trim().toUpperCase(),
      description:       c.description || null,
      pulled_date:       visitDate || null,
      service_record_id: diagnosticRecordId,
      document_id:       documentId,
    })))
    if (error) throw error
    created.codes = codes.length
  }

  // ── Recommended work → pending items (9.4) ───────────────────────────────────
  const work = (findings.work || []).filter(w => w.include && w.title?.trim())
  if (work.length) {
    const { error } = await supabase.from('pending_work').insert(work.map(w => ({
      vehicle_id:         vehicleId,
      title:              w.title.trim(),
      description:        w.description || null,
      priority:           w.priority || 'medium',
      status:             'pending',
      identified_date:    visitDate || null,
      source:             'From uploaded document',
      source_document_id: documentId,
    })))
    if (error) throw error
    created.work = work.length
  }

  return created
}

/** Item 24: default visit title = the service-item titles joined */
export function defaultVisitTitle(records) {
  return (records || [])
    .map(r => r.title?.trim()).filter(Boolean)
    .join(' · ')
    .slice(0, 120)
}
