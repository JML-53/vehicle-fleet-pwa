/**
 * inspections — Virginia inspection rules shared by the inspection form and
 * document import (items 22, 28, 9.3). Keep the two in step by using this.
 */
import { format, addMonths, addDays, endOfMonth, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'

export const INTERVAL = { safety: 12, emissions: 24 }
// Re-test window after a fail. Per-vehicle values live on inspections.grace_days;
// these are the defaults (VA: 15-day rejection sticker for safety, 14-day free
// re-test for emissions).
export const GRACE = { safety: 15, emissions: 14 }

const toDate = d => (typeof d === 'string' ? parseISO(d) : d)

/** VA rule: expires end of month, interval_months after the inspection month */
export function calcExpiryDate(inspectionDate, intervalMonths) {
  if (!inspectionDate || !intervalMonths) return ''
  return format(endOfMonth(addMonths(toDate(inspectionDate), intervalMonths)), 'yyyy-MM-dd')
}

/** Pass → VA end-of-month expiry; Fail → re-test-by date (date + grace days) */
export function calcDueDate(inspectionDate, type, result, graceDays) {
  if (!inspectionDate || !type) return ''
  if (result === 'fail') {
    return format(addDays(toDate(inspectionDate), graceDays ?? GRACE[type]), 'yyyy-MM-dd')
  }
  return calcExpiryDate(inspectionDate, INTERVAL[type])
}

/** The vehicle's template row for a type, created if missing → { id, grace_days } */
export async function ensureInspectionTemplate(vehicleId, type) {
  const { data, error } = await supabase
    .from('inspections').select('id, grace_days')
    .eq('vehicle_id', vehicleId).eq('inspection_type', type)
    .maybeSingle()
  if (error) throw error
  if (data) return data
  const { data: created, error: cErr } = await supabase
    .from('inspections')
    .insert({ vehicle_id: vehicleId, inspection_type: type, interval_months: INTERVAL[type], grace_days: GRACE[type] })
    .select('id, grace_days').single()
  if (cErr) throw cErr
  return created
}

/** Words that identify which inspection a service-record title is about */
export const TYPE_WORDS = { safety: /safety|state (vehicle )?inspection/i, emissions: /emission/i }
