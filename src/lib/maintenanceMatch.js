/**
 * maintenanceMatch — link service_records to the maintenance_schedule items
 * they fulfil (roadmap item 12.2).
 *
 * last_done_date / last_done_mileage are derived by the maintenance_due_soon
 * view from maintenance_fulfillments, so creating the fulfillment row is all
 * it takes to move an item's due date forward.
 *
 * Two call sites share this module:
 *   • manual entry  — MaintenanceLinkPicker on the service-record forms
 *   • AI extraction — parse-document results (item 9.4) can score the same way
 */
import { supabase } from '@/lib/supabase'

// Score at/above which an item is shown as a suggestion
export const SUGGEST_THRESHOLD = 1
// Score at/above which a new record pre-selects the item
export const AUTO_THRESHOLD    = 2

// Words that carry no matching signal
const STOPWORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'per', 'all', 'new', 'full', 'both',
  'mo', 'mi', 'miles', 'month', 'months', 'annual',
])

// Light suffix stemmer so rotate/rotation, replace/replaced, tire/tires collide
function stem(w) {
  const s = w.replace(/(ions?|ing|ed|es|e|s)$/, '')
  return s.length >= 3 ? s : w
}

// Words that are shared by many unrelated items — half weight (stored stemmed)
const GENERIC = new Set([
  'fluid', 'filter', 'service', 'inspection', 'inspect', 'system', 'replace',
  'replacement', 'change', 'check', 'flush', 'lube', 'lubrication', 'front',
  'rear', 'engine', 'level', 'top', 'off',
].map(stem))

// Categories too broad to count as evidence on their own
const GENERIC_CATEGORIES = new Set(['other', 'diagnostic'])

// A category match is normally weak evidence (0.5); oil_change is unambiguous
const CATEGORY_WEIGHT = { oil_change: 1 }

function tokenize(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w))
      .map(stem)
  )
}

/**
 * How well does a service record (title + category) match a schedule item?
 * Shared specific word = 1, shared generic word = 0.5, same specific category = 0.5
 * (oil_change = 1).
 */
export function scoreMatch(record, scheduleItem) {
  const recTokens  = tokenize(record.title)
  const itemTokens = tokenize(scheduleItem.service_item)
  let score = 0
  for (const t of itemTokens) {
    if (recTokens.has(t)) score += GENERIC.has(t) ? 0.5 : 1
  }
  if (
    record.category &&
    record.category === scheduleItem.category &&
    !GENERIC_CATEGORIES.has(record.category)
  ) {
    score += CATEGORY_WEIGHT[record.category] ?? 0.5
  }
  return score
}

/** Schedule items ranked by match score (highest first), each with `score`. */
export function rankScheduleItems(record, scheduleItems) {
  return (scheduleItems || [])
    .map(item => ({ ...item, score: scoreMatch(record, item) }))
    .sort((a, b) => b.score - a.score || a.service_item.localeCompare(b.service_item))
}

/** Ids of schedule items strong enough to pre-select for a new record. */
export function autoMatchIds(record, scheduleItems) {
  return rankScheduleItems(record, scheduleItems)
    .filter(i => i.score >= AUTO_THRESHOLD)
    .map(i => i.id)
}

/**
 * Make the record's maintenance_fulfillments match `scheduleIds` exactly:
 * delete links no longer wanted, insert missing ones, and mark newly linked
 * schedule items as confirmed (same rule AddMaintenanceItem applies).
 */
export async function syncMaintenanceLinks(serviceRecordId, scheduleIds = []) {
  const { data: current, error } = await supabase
    .from('maintenance_fulfillments')
    .select('id, maintenance_schedule_id')
    .eq('service_record_id', serviceRecordId)
  if (error) throw error

  const wanted   = new Set(scheduleIds)
  const have     = new Set(current.map(f => f.maintenance_schedule_id))
  const toDelete = current.filter(f => !wanted.has(f.maintenance_schedule_id)).map(f => f.id)
  const toAdd    = [...wanted].filter(id => !have.has(id))

  if (toDelete.length) {
    const { error } = await supabase.from('maintenance_fulfillments').delete().in('id', toDelete)
    if (error) throw error
  }

  if (toAdd.length) {
    const { error } = await supabase.from('maintenance_fulfillments').insert(
      toAdd.map(id => ({
        maintenance_schedule_id: id,
        service_record_id:       serviceRecordId,
        notes:                   'Linked from service record',
      }))
    )
    if (error) throw error

    const { error: confErr } = await supabase
      .from('maintenance_schedule')
      .update({ knowledge_status: 'confirmed' })
      .in('id', toAdd)
    if (confErr) throw confErr
  }

  return { added: toAdd.length, removed: toDelete.length }
}

/** Query keys to invalidate after links change. */
export function invalidateMaintenance(qc, vehicleId) {
  qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] })
  qc.invalidateQueries({ queryKey: ['maintenance_due_soon_all'] })
  qc.invalidateQueries({ queryKey: ['fulfillments'] })
}
