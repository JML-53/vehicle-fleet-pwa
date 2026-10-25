/**
 * Guides (item 29, phase 1b): saved job procedures the mechanic writes, and
 * runs — each time the job is done, checked off step by step.
 *
 * guides.body holds the sections from the mechanic's propose_guide tool:
 *   { difficulty, time_estimate, summary, tools, parts, supplies, safety,
 *     steps: [{ title, detail, size, torque, caution, tip }],
 *     mistakes, tips, after, specs, sources }
 * At most one run per guide is active, so everyone on the job shares it.
 * Step ticks are upserted one row per step (two phones never overwrite each other).
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const DIFFICULTY_META = {
  easy:     { label: 'Easy',     badge: 'badge-green' },
  moderate: { label: 'Moderate', badge: 'badge-blue' },
  hard:     { label: 'Hard',     badge: 'badge-amber' },
  expert:   { label: 'Expert',   badge: 'badge-red' },
}

const BODY_KEYS = ['difficulty', 'time_estimate', 'summary', 'tools', 'parts', 'supplies', 'safety',
                   'steps', 'mistakes', 'tips', 'after', 'specs', 'sources']

/** The guide body from a propose_guide card's input (drops vehicle_id, guide_id, title, job_type) */
export const bodyFromCard = input => Object.fromEntries(BODY_KEYS.map(k => [k, input[k]]))

// ── Queries ──────────────────────────────────────────────────────────────────

export function useGuides(vehicleId) {
  return useQuery({
    queryKey: ['guides', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('guides')
        .select('id, title, job_type, version, verified_at, body, updated_at, guide_runs(id, status, started_at)')
        .eq('vehicle_id', vehicleId).order('title')
      if (error) throw error
      return data
    },
    enabled: !!vehicleId,
  })
}

/** Every guide in the fleet (the Guides page) */
export function useAllGuides() {
  return useQuery({
    queryKey: ['guides', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('guides')
        .select('id, title, job_type, version, verified_at, body, vehicle_id, vehicles(name, status), guide_runs(id, status, started_at)')
        .order('title')
      if (error) throw error
      return data
    },
  })
}

/**
 * The topic a guide is filed under: the mechanic's job_type ("Oil change"),
 * compared case-insensitively so "Oil change" and "oil change" group together.
 */
export function guideTopic(g) {
  const t = (g.job_type || '').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Other'
}

export function useGuide(id) {
  return useQuery({
    queryKey: ['guide', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('guides')
        .select('*, vehicles(id, name), guide_runs(id, status, outcome, started_at, finished_at, started_by, pending_work_id, guide_version)')
        .eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

/** A run with its step rows. Polls so two people on the same job see each other's ticks. */
export function useGuideRun(runId) {
  return useQuery({
    queryKey: ['guide_run', runId],
    queryFn: async () => {
      const { data, error } = await supabase.from('guide_runs')
        .select('*, guide_run_steps(step_index, done_at, done_by, note)')
        .eq('id', runId).single()
      if (error) throw error
      return data
    },
    enabled: !!runId,
    refetchInterval: 10_000,
  })
}

/** Specs already saved to the vehicle from this guide (by name) */
export function useGuideSavedSpecs(guideId) {
  return useQuery({
    queryKey: ['known_specs', 'from_guide', guideId],
    queryFn: async () => {
      const { data, error } = await supabase.from('known_specs').select('id, spec_name, verification').eq('guide_id', guideId)
      if (error) throw error
      return data
    },
    enabled: !!guideId,
  })
}

// ── Saving a guide from a mechanic card ──────────────────────────────────────

/**
 * New guide, or a new version of input.guide_id. Links the guide to the pending
 * item the chat was opened from when that item has none. Returns the guide id.
 */
export async function saveGuideFromCard(card, { conversationId, entry }) {
  const i = card.input
  if (i.guide_id) {
    const { data: g, error: e1 } = await supabase.from('guides').select('version, tool_use_ids').eq('id', i.guide_id).single()
    if (e1) throw e1
    if (g.tool_use_ids.includes(card.id)) return i.guide_id   // already saved (another tap or phone)
    const { error } = await supabase.from('guides').update({
      title: i.title, job_type: i.job_type || null, body: bodyFromCard(i),
      version: g.version + 1, verified_at: null, verified_by: null,   // a new version needs re-verifying
      conversation_id: conversationId, source_tool_use_id: card.id, tool_use_ids: [...g.tool_use_ids, card.id],
    }).eq('id', i.guide_id)
    if (error) throw error
    return i.guide_id
  }

  const { data, error } = await supabase.from('guides').insert({
    vehicle_id: i.vehicle_id, title: i.title, job_type: i.job_type || null, body: bodyFromCard(i),
    conversation_id: conversationId, source_tool_use_id: card.id, tool_use_ids: [card.id],
  }).select('id').single()
  if (error?.code === '23505') {   // this card was already saved
    const { data: g } = await supabase.from('guides').select('id').eq('source_tool_use_id', card.id).single()
    return g.id
  }
  if (error) throw error

  if (entry?.kind === 'pending item' && entry.id) {
    await supabase.from('pending_work').update({ guide_id: data.id }).eq('id', entry.id).is('guide_id', null)
  }
  return data.id
}

/** "Save all specs to the vehicle": unverified, linked to the guide; skips ones already saved */
export async function saveGuideSpecs(guide, alreadySaved = []) {
  const have = new Set(alreadySaved.map(s => s.spec_name.toLowerCase()))
  const rows = (guide.body?.specs ?? [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !have.has(s.name.toLowerCase()))
    .filter(({ s }) => !(s.safety_critical && s.source_type === 'ai_knowledge'))
    .map(({ s, i }) => ({
      vehicle_id:         guide.vehicle_id,
      spec_category:      s.category || 'Other',
      spec_name:          s.name,
      spec_value:         s.value,
      units:              s.units || null,
      source:             s.source_type,
      source_ref:         s.source_ref || null,
      safety_critical:    !!s.safety_critical,
      guide_id:           guide.id,
      conversation_id:    guide.conversation_id,
      source_tool_use_id: `guide:${guide.id}:v${guide.version}:${i}`,
    }))
  if (!rows.length) return 0
  const { error } = await supabase.from('known_specs').insert(rows)
  if (error) throw error
  return rows.length
}

// ── Doing the job ────────────────────────────────────────────────────────────

/** Resume the active run, or start one (optionally for a pending item). Returns the run id. */
export async function startOrResumeRun(guide, { pendingWorkId } = {}) {
  const active = (guide.guide_runs ?? []).find(r => r.status === 'active')
  if (active) return active.id
  const { data, error } = await supabase.from('guide_runs').insert({
    guide_id: guide.id, guide_version: guide.version, pending_work_id: pendingWorkId || null,
  }).select('id').single()
  if (error?.code === '23505') {   // someone else started it a moment ago
    const { data: r } = await supabase.from('guide_runs').select('id').eq('guide_id', guide.id).eq('status', 'active').single()
    return r.id
  }
  if (error) throw error
  if (pendingWorkId) {
    await supabase.from('pending_work').update({ guide_id: guide.id }).eq('id', pendingWorkId).is('guide_id', null)
  }
  return data.id
}

export async function setStepDone(runId, stepIndex, done, userId) {
  const { error } = await supabase.from('guide_run_steps').upsert(
    { run_id: runId, step_index: stepIndex, done_at: done ? new Date().toISOString() : null, done_by: done ? userId : null },
    { onConflict: 'run_id,step_index' })
  if (error) throw error
}

export async function setStepNote(runId, stepIndex, note) {
  const { error } = await supabase.from('guide_run_steps').upsert(
    { run_id: runId, step_index: stepIndex, note: note || null },
    { onConflict: 'run_id,step_index' })
  if (error) throw error
}

/**
 * outcome: 'as_written' | 'with_changes' | null (abandoned).
 * "As written" on the current version marks the guide verified.
 */
export async function finishRun(run, guide, outcome, userId) {
  const now = new Date().toISOString()
  const { error } = await supabase.from('guide_runs').update({
    status: outcome ? 'finished' : 'abandoned', outcome, finished_at: now,
  }).eq('id', run.id)
  if (error) throw error
  if (outcome === 'as_written' && run.guide_version === guide.version) {
    const { error: e2 } = await supabase.from('guides').update({ verified_at: now, verified_by: userId }).eq('id', guide.id)
    if (e2) throw e2
  }
}

/** Mark the specs saved from this guide "worked as written" */
export async function verifyGuideSpecs(guideId, userId) {
  const { error } = await supabase.from('known_specs')
    .update({ verification: 'worked_as_written', verified_at: new Date().toISOString(), verified_by: userId })
    .eq('guide_id', guideId).is('verification', null)
  if (error) throw error
}

// ── Reading a guide aloud ────────────────────────────────────────────────────

export const GUIDE_SECTIONS = [
  ['overview', 'Overview'], ['tools', 'Tools'], ['parts', 'Parts & supplies'], ['safety', 'Safety'],
  ['steps', 'Steps'], ['mistakes', 'Common mistakes'], ['tips', 'Tips'], ['after', 'After the job'], ['specs', 'Specs'],
]
export const SECTION_LABEL = Object.fromEntries(GUIDE_SECTIONS)

/** What's read aloud for one step (check-off mode reads it on arriving at the step) */
export function stepSpeech(step, i, n) {
  if (!step) return "That's every step. Check the after-the-job list, then tap Finish job."
  return [
    `Step ${i + 1} of ${n}. ${step.title}.`,
    step.detail,
    step.size && (/^\d/.test(step.size)
      ? `Use ${/^(8|11|18)(?!\d)|^8\d/.test(step.size) ? 'an' : 'a'} ${step.size}.`   // an 8 mm, an 11/16"
      : `Size: ${step.size}.`),                                                    // "Likely 14 mm (confirm)"
    step.torque && `${step.torque}.`,
    step.caution && `Caution: ${step.caution}`,
    step.tip && `Tip: ${step.tip}`,
  ].filter(Boolean).join(' ')
}

/**
 * A guide as an ordered list of spoken pieces, for play / pause / skip and
 * jumping between sections: [{ key, section, text, step? }]. Skipping moves
 * one piece (one step, one tool, one tip…); the first piece of a section says
 * the section's name.
 */
export function guideSegments(guide) {
  const b = guide?.body ?? {}
  const out = []
  const add = (section, items, toText) => (items ?? []).forEach((it, n) => {
    const text = toText(it, n)
    if (text) out.push({ key: `${section}-${n}`, section, text: n === 0 && section !== 'steps' ? `${SECTION_LABEL[section]}. ${text}` : text })
  })
  const diff = DIFFICULTY_META[b.difficulty]?.label
  add('overview', [1], () => [`${guide.title}.`, diff && `${diff}.`, b.time_estimate && `About ${b.time_estimate}.`, b.summary].filter(Boolean).join(' '))
  add('tools', b.tools, t => `${t.name}${t.size ? `, ${t.size}` : ''}.${t.note ? ` ${t.note}.` : ''}`)
  add('parts', [...(b.parts ?? []), ...((b.supplies ?? []).length ? [{ supplies: b.supplies }] : [])], p => p.supplies
    ? `Shop supplies: ${p.supplies.map(s => (s.quantity ? `${s.name}, ${s.quantity}` : s.name)).join('; ')}.`
    : `${[p.quantity, p.brand, p.name].filter(Boolean).join(' ')}${p.part_number ? `, part number ${p.part_number}` : ''}.${p.note ? ` ${p.note}.` : ''}`)
  add('safety', b.safety, s => s)
  ;(b.steps ?? []).forEach((s, i, all) => out.push({ key: `steps-${i}`, section: 'steps', step: i, text: stepSpeech(s, i, all.length) }))
  add('mistakes', b.mistakes, s => s)
  add('tips', b.tips, s => s)
  add('after', b.after, s => s)
  add('specs', b.specs, s => `${s.name}: ${s.value}${s.units ? ` ${s.units}` : ''}.`)
  return out
}

/** The step a run should open on: the first one not yet done */
export function firstOpenStep(run, stepCount) {
  const done = new Set((run?.guide_run_steps ?? []).filter(s => s.done_at).map(s => s.step_index))
  for (let i = 0; i < stepCount; i++) if (!done.has(i)) return i
  return stepCount   // all done → the "after the job" panel
}

export function invalidateGuides(qc, vehicleId, guideId) {
  qc.invalidateQueries({ queryKey: ['guides', vehicleId] })
  if (guideId) qc.invalidateQueries({ queryKey: ['guide', guideId] })
  qc.invalidateQueries({ queryKey: ['ai_saved_cards'] })
}
