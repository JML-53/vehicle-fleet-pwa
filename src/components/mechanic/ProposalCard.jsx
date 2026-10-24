/**
 * ProposalCard — a "save this" card the mechanic proposed (item 29, phase 1a).
 *
 *   propose_spec         → editable spec, saved to known_specs with its source;
 *                          shows "unverified" until someone checks it (decision 2b)
 *   propose_note         → editable note, saved to vehicle_notes
 *   propose_pending_work → opens the existing Add Pending Work form pre-filled
 *                          ("open-in-form": the form does the saving)
 *   propose_guide        → 1b: a new guide, or a new version of an existing one
 *
 * Saves run as the signed-in user, so RLS and the change log apply. The card's
 * tool_use id goes in source_tool_use_id (unique), so a card saves only once.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Ruler, StickyNote, ClipboardPlus, CheckCircle2, ShieldAlert, ExternalLink, BookOpen } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { SPEC_SOURCE_LABEL, hostname, useVehicleChoices } from '@/lib/mechanic'
import { PRIORITY_META } from '@/lib/pendingWork'
import { DIFFICULTY_META, saveGuideFromCard, invalidateGuides } from '@/lib/guides'

const NOTE_CATEGORIES = ['observation', 'warning', 'tip', 'history', 'quirk', 'other']
const today = () => new Date().toISOString().slice(0, 10)

export default function ProposalCard({ card, conversation, conversationId, saved }) {
  if (card.refused) return null   // the function rejected it; the answer explains why
  if (card.name === 'propose_spec')         return <SpecCard  card={card} conversationId={conversationId} saved={saved} />
  if (card.name === 'propose_note')         return <NoteCard  card={card} conversationId={conversationId} saved={saved} />
  if (card.name === 'propose_pending_work') return <WorkCard  card={card} />
  if (card.name === 'propose_guide')        return <GuideCard card={card} conversation={conversation} conversationId={conversationId} savedGuideId={saved} />
  return null
}

// Every card names its vehicle: in a chat that drifts to another vehicle, the
// mechanic may target that one, and a save shouldn't land somewhere unnoticed.
function Shell({ Icon, title, vehicleId, children }) {
  const { data: vehicles = [] } = useVehicleChoices()
  const vehicle = vehicles.find(v => v.id === vehicleId)?.name
  return (
    <div className="border border-primary-100 bg-primary-50/60 rounded-lg p-3 space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-primary-800 uppercase tracking-wide">
        <Icon size={13} /> {title}
        {vehicle && <span className="ml-auto normal-case tracking-normal font-semibold bg-white border border-primary-100 rounded-full px-2 py-0.5">{vehicle}</span>}
      </p>
      {children}
    </div>
  )
}

function SavedLine({ to, label }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-green-700">
      <CheckCircle2 size={14} /> Saved to <Link to={to} className="underline">{label}</Link>
    </p>
  )
}

function useSave(conversationId, vehicleId, queryKey) {
  const qc = useQueryClient()
  const [state, setState] = useState({ busy: false, error: null })
  async function save(table, row) {
    setState({ busy: true, error: null })
    const { error } = await supabase.from(table).insert(row)
    // 23505 = this card was already saved (e.g. on another phone)
    if (error && error.code !== '23505') { setState({ busy: false, error: error.message }); return }
    setState({ busy: false, error: null })
    qc.invalidateQueries({ queryKey: ['ai_saved_cards', conversationId] })
    qc.invalidateQueries({ queryKey: [queryKey, vehicleId] })
  }
  return [state, save]
}

function SpecCard({ card, conversationId, saved }) {
  const i = card.input
  const [v, setV] = useState({
    spec_category: i.spec_category, spec_name: i.spec_name, spec_value: i.spec_value,
    units: i.units, notes: i.notes,
  })
  const [state, save] = useSave(conversationId, i.vehicle_id, 'known_specs')
  const set = k => e => setV(s => ({ ...s, [k]: e.target.value }))
  const isUrl = /^https?:\/\//.test(i.source_ref || '')

  if (saved) return <Shell vehicleId={i.vehicle_id} Icon={Ruler} title="Spec"><SavedLine to={`/vehicles/${i.vehicle_id}?tab=specs`} label="Specs" />
    <p className="text-sm text-slate-700">{v.spec_name}: <strong>{v.spec_value}{v.units ? ` ${v.units}` : ''}</strong></p></Shell>

  return (
    <Shell vehicleId={i.vehicle_id} Icon={Ruler} title="Save this spec?">
      <div className="grid grid-cols-2 gap-2">
        <input className="field-input text-sm" value={v.spec_category} onChange={set('spec_category')} aria-label="Category" />
        <input className="field-input text-sm" value={v.spec_name} onChange={set('spec_name')} aria-label="Name" />
        <input className="field-input text-sm font-semibold" value={v.spec_value} onChange={set('spec_value')} aria-label="Value" />
        <input className="field-input text-sm" value={v.units} onChange={set('units')} placeholder="units" aria-label="Units" />
      </div>
      <input className="field-input text-sm" value={v.notes} onChange={set('notes')} placeholder="Notes" aria-label="Notes" />
      <p className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="badge-amber">unverified</span>
        From {SPEC_SOURCE_LABEL[i.source_type] ?? i.source_type}
        {i.source_ref && (isUrl
          ? <a href={i.source_ref} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
              {hostname(i.source_ref)} <ExternalLink size={10} /></a>
          : <span>: {i.source_ref}</span>)}
        {i.safety_critical && <span className="inline-flex items-center gap-0.5 text-red-700"><ShieldAlert size={12} /> safety-critical</span>}
      </p>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <button type="button" className="btn-primary text-sm py-1.5" disabled={state.busy || !v.spec_name || !v.spec_value}
        onClick={() => save('known_specs', {
          vehicle_id:         i.vehicle_id,
          spec_category:      v.spec_category || 'Other',
          spec_name:          v.spec_name,
          spec_value:         v.spec_value,
          units:              v.units || null,
          notes:              v.notes || null,
          source:             i.source_type,
          source_ref:         i.source_ref || null,
          safety_critical:    !!i.safety_critical,
          conversation_id:    conversationId,
          source_tool_use_id: card.id,
        })}>
        {state.busy ? 'Saving…' : 'Save spec'}
      </button>
    </Shell>
  )
}

function NoteCard({ card, conversationId, saved }) {
  const i = card.input
  const { profile } = useAuth()
  const [category, setCategory] = useState(i.category)
  const [text, setText] = useState(i.note_text)
  const [state, save] = useSave(conversationId, i.vehicle_id, 'vehicle_notes')

  if (saved) return <Shell vehicleId={i.vehicle_id} Icon={StickyNote} title="Note"><SavedLine to={`/vehicles/${i.vehicle_id}?tab=notes`} label="Notes" /></Shell>

  return (
    <Shell vehicleId={i.vehicle_id} Icon={StickyNote} title="Save this note?">
      <select className="field-select text-sm" value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
        {NOTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <textarea className="field-textarea text-sm" rows={4} value={text} onChange={e => setText(e.target.value)} aria-label="Note" />
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <button type="button" className="btn-primary text-sm py-1.5" disabled={state.busy || !text.trim()}
        onClick={() => save('vehicle_notes', {
          vehicle_id:         i.vehicle_id,
          note_date:          today(),
          category,
          note_text:          text.trim(),
          created_by:         profile?.display_name ?? null,
          conversation_id:    conversationId,
          source_tool_use_id: card.id,
        })}>
        {state.busy ? 'Saving…' : 'Save note'}
      </button>
    </Shell>
  )
}

function GuideCard({ card, conversation, conversationId, savedGuideId }) {
  const i = card.input
  const qc = useQueryClient()
  const [showSteps, setShowSteps] = useState(false)
  const [state, setState] = useState({ busy: false, error: null })
  const steps = i.steps ?? []
  const diff = DIFFICULTY_META[i.difficulty] ?? { label: i.difficulty, badge: 'badge-slate' }
  const isUpdate = !!i.guide_id

  async function save() {
    setState({ busy: true, error: null })
    try {
      const id = await saveGuideFromCard(card, { conversationId, entry: conversation?.entry })
      invalidateGuides(qc, i.vehicle_id, id)
      qc.invalidateQueries({ queryKey: ['pending_work_item'] })
      setState({ busy: false, error: null })
    } catch (err) {
      setState({ busy: false, error: err.message })
    }
  }

  return (
    <Shell vehicleId={i.vehicle_id} Icon={BookOpen} title={savedGuideId ? 'Guide' : isUpdate ? 'Save the updated guide?' : 'Save this guide?'}>
      <p className="text-sm font-semibold text-slate-800">{i.title}</p>
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className={diff.badge}>{diff.label}</span>
        {i.time_estimate && <span>{i.time_estimate}</span>}
        <span>{steps.length} steps · {(i.tools ?? []).length} tools · {(i.parts ?? []).length} parts</span>
      </p>
      {i.summary && <p className="text-xs text-slate-600">{i.summary}</p>}
      <button type="button" onClick={() => setShowSteps(s => !s)} className="text-xs text-primary-700 underline">
        {showSteps ? 'Hide steps' : 'Show steps'}
      </button>
      {showSteps && (
        <ol className="list-decimal pl-5 text-xs text-slate-700 space-y-0.5">
          {steps.map((s, n) => <li key={n}>{s.title}{s.torque ? <strong> · {s.torque}</strong> : ''}</li>)}
        </ol>
      )}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {savedGuideId
        ? <p className="flex items-center gap-1.5 text-sm text-green-700">
            <CheckCircle2 size={14} /> Saved · <Link to={`/guides/${savedGuideId}`} className="underline">Open guide</Link>
          </p>
        : <button type="button" className="btn-primary text-sm py-1.5" disabled={state.busy} onClick={save}>
            {state.busy ? 'Saving…' : isUpdate ? 'Save as new version' : 'Save guide'}
          </button>}
    </Shell>
  )
}

function WorkCard({ card }) {
  const i = card.input
  const navigate = useNavigate()
  const pr = PRIORITY_META[i.priority] ?? { label: i.priority, badge: 'badge-slate' }
  return (
    <Shell vehicleId={i.vehicle_id} Icon={ClipboardPlus} title="Add to pending work?">
      <p className="text-sm font-semibold text-slate-800">{i.title}</p>
      {i.description && <p className="text-xs text-slate-600 line-clamp-4">{i.description}</p>}
      <p><span className={pr.badge}>{pr.label}</span></p>
      <button type="button" className="btn-primary text-sm py-1.5"
        onClick={() => navigate(`/vehicles/${i.vehicle_id}/add-pending`, {
          state: { prefill: { title: i.title, description: i.description, priority: i.priority } },
        })}>
        Open in form
      </button>
    </Shell>
  )
}
