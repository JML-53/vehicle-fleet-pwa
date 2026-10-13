/**
 * CloseOutSession — record what happened in a work session (item 32 phase 2b).
 * Route: /sessions/:sessionId/close   (layout approved in the "Fleet Workflow Mockups")
 *
 * Per vehicle: visit details, an outcome for every planned item (required),
 * work done that wasn't planned; then "Found something new?" and a summary.
 * Saved in one transaction by close_work_session (see lib/workSessions.js):
 *   Done        → service record that resolves the item
 *   Partly done → record that doesn't resolve it; "what's left"; back to the
 *                 Later list, into another session, or split the rest off
 *   Not done    → reason; back to the Later list or into another session
 *   No longer needed → item cancelled with the reason
 * New findings get one new source per vehicle: the visit logged here, or
 * "Found during <session>" when nothing was logged for that vehicle.
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useProfiles } from '@/lib/changeLog'
import { useEnumValues, enumLabel } from '@/lib/enums'
import { PRIORITY_META, useShopsList } from '@/lib/pendingWork'
import {
  useWorkSession, useWorkSessions, useLastMileage, closeSession, invalidateSessions,
  sessionLabel, guessCategory, OUTCOME_META,
} from '@/lib/workSessions'

const OUTCOMES = ['done', 'partial', 'not_done', 'dropped']
const today = () => new Date().toISOString().split('T')[0]
const blankRecord  = () => ({ title: '', category: 'other', total_cost: '' })
const blankFinding = vehicleId => ({ vehicle_id: vehicleId, title: '', priority: 'medium', assigned_to: '', due_date: '', session_id: '' })

export default function CloseOutSession() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: s, isLoading } = useWorkSession(sessionId)
  const { data: plannedSessions = [] } = useWorkSessions('planned')
  const { data: people = {} } = useProfiles()
  const { data: shops = [] } = useShopsList()
  const categories = useEnumValues('service_category')
  const [form, setForm]   = useState(null)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  // Planned items grouped by vehicle
  const vehicles = useMemo(() => {
    const m = new Map()
    for (const si of (s?.items || []).filter(i => i.outcome == null && i.pending_work)) {
      const p = si.pending_work
      if (!m.has(p.vehicle_id)) m.set(p.vehicle_id, { id: p.vehicle_id, name: p.vehicles?.name || 'Unknown vehicle', items: [] })
      m.get(p.vehicle_id).items.push(si)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [s])
  const { data: lastMiles = {} } = useLastMileage(vehicles.map(v => v.id))
  const otherSessions = plannedSessions.filter(x => x.id !== sessionId)

  useEffect(() => {
    if (!s || form) return
    setForm({
      vehicles: Object.fromEntries(vehicles.map(v => [v.id, {
        visit: { visit_date: s.planned_date || today(), mileage: '', shop_id: s.shop_id || '', total_cost: '', notes: '' },
        items: Object.fromEntries(v.items.map(si => {
          const p = si.pending_work
          if (p.status === 'completed') return [si.id, { outcome: 'done', locked: true }]
          if (p.status === 'cancelled') return [si.id, { outcome: 'dropped', locked: true }]
          return [si.id, { outcome: '', note: '', record: { title: p.title, category: guessCategory(p.title), total_cost: '' },
                           next: { kind: 'lane', session_id: '' } }]
        })),
        extra: [],
      }])),
      findings: [],
    })
  }, [s, vehicles]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !s) return <p className="p-6 text-sm text-slate-400 animate-pulse">Loading session…</p>
  if (s.status !== 'planned') {
    return (
      <div className="p-6 text-sm space-y-2">
        <p>This session is already {s.status}.</p>
        <Link to={`/sessions/${s.id}`} className="text-primary-700 underline">Open the session</Link>
      </div>
    )
  }
  if (!form) return null

  // ── State helpers ──
  const setVehicle = (vid, fn) => setForm(f => ({ ...f, vehicles: { ...f.vehicles, [vid]: fn(f.vehicles[vid]) } }))
  const setVisit   = (vid, patch) => setVehicle(vid, v => ({ ...v, visit: { ...v.visit, ...patch } }))
  const setItem    = (vid, siId, patch) => setVehicle(vid, v => ({ ...v, items: { ...v.items, [siId]: { ...v.items[siId], ...patch } } }))
  const setFinding = (i, patch) => setForm(f => ({ ...f, findings: f.findings.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))

  // ── Summary ──
  const allItems  = vehicles.flatMap(v => v.items.map(si => ({ v, si, st: form.vehicles[v.id].items[si.id] })))
  const missing   = allItems.filter(x => !x.st.outcome)
  const count     = k => allItems.filter(x => !x.st.locked && x.st.outcome === k).length
  const visitsFor = vehicles.filter(v => allItems.some(x => x.v.id === v.id && !x.st.locked && ['done', 'partial'].includes(x.st.outcome))
                                   || form.vehicles[v.id].extra.some(r => r.title.trim()))
  const moved     = allItems.filter(x => ['partial', 'not_done'].includes(x.st.outcome) && x.st.next?.kind === 'session').length
  const findings  = form.findings.filter(f => f.title.trim())
  const badNext   = allItems.filter(x => x.st.next?.kind === 'session' && !x.st.next.session_id)

  async function save() {
    setBusy(true); setError('')
    try {
      const payload = {
        vehicles: vehicles.map(v => {
          const fv = form.vehicles[v.id]
          return {
            vehicle_id: v.id,
            visit: fv.visit,
            items: v.items.map(si => {
              const st = fv.items[si.id]
              return {
                session_item_id: si.id, outcome: st.outcome, note: st.note || '',
                ...(['done', 'partial'].includes(st.outcome) && !st.locked ? { record: st.record } : {}),
                ...(['partial', 'not_done'].includes(st.outcome) ? { next: st.next } : {}),
              }
            }),
            extra_records: fv.extra.filter(r => r.title.trim()),
            findings: findings.filter(f => f.vehicle_id === v.id),
          }
        }),
      }
      await closeSession(s.id, payload)
      invalidateSessions(qc, vehicles.map(v => v.id))
      navigate(`/sessions/${s.id}`, { replace: true })
    } catch (e) {
      setError(e.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const personName = id => (id ? people[id]?.display_name : null)

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <p className="text-primary-300 text-xs">Close out session</p>
        <h1 className="text-xl font-bold">{s.title}</h1>
        <p className="text-primary-200 text-sm mt-0.5">
          {sessionLabel(s).split(' · ')[1]} · {personName(s.assigned_to) || 'Nobody yet'} · {s.shop?.name || 'DIY'}
          {' · '}{allItems.length} item{allItems.length === 1 ? '' : 's'} on {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="p-4 space-y-5 max-w-3xl mx-auto pb-12">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {vehicles.map((v, vi) => {
          const fv = form.vehicles[v.id]
          const last = lastMiles[v.id]
          return (
            <section key={v.id} className="card space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-800">
                  {v.name} {vehicles.length > 1 && <span className="text-sm font-normal text-slate-500">· {vi + 1} of {vehicles.length}</span>}
                </h2>
                <span className="text-xs text-slate-400">A visit is saved only if something was done</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="block"><span className="field-label">Date</span>
                  <input type="date" className="field-input" value={fv.visit.visit_date} onChange={e => setVisit(v.id, { visit_date: e.target.value })} /></label>
                <label className="block"><span className="field-label">Mileage</span>
                  <input inputMode="numeric" className="field-input" value={fv.visit.mileage}
                    placeholder={last ? `last: ${Number(last.mileage).toLocaleString()}` : ''}
                    onChange={e => setVisit(v.id, { mileage: e.target.value.replace(/[^\d]/g, '') })} /></label>
                <label className="block"><span className="field-label">Shop</span>
                  <select className="field-select" value={fv.visit.shop_id} onChange={e => setVisit(v.id, { shop_id: e.target.value })}>
                    <option value="">DIY</option>
                    {shops.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                  </select></label>
                <label className="block"><span className="field-label">Total cost</span>
                  <input inputMode="decimal" className="field-input" value={fv.visit.total_cost} placeholder="$"
                    onChange={e => setVisit(v.id, { total_cost: e.target.value.replace(/[^\d.]/g, '') })} /></label>
              </div>

              <h3 className="card-header mb-0">Planned work — what happened?</h3>
              {v.items.map(si => (
                <ItemOutcome key={si.id} si={si} st={fv.items[si.id]} set={patch => setItem(v.id, si.id, patch)}
                  categories={categories} otherSessions={otherSessions}
                  personName={personName(si.pending_work.assigned_to)} />
              ))}

              {fv.extra.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 items-end border border-slate-200 rounded-xl p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-2">
                    <label className="block"><span className="field-label">Work not on the plan</span>
                      <input className="field-input" value={r.title} placeholder="e.g. Tire rotation"
                        onChange={e => setVehicle(v.id, x => ({ ...x, extra: x.extra.map((y, j) => (j === i ? { ...y, title: e.target.value, category: y.touched ? y.category : guessCategory(e.target.value) } : y)) }))} /></label>
                    <label className="block"><span className="field-label">Category</span>
                      <select className="field-select" value={r.category}
                        onChange={e => setVehicle(v.id, x => ({ ...x, extra: x.extra.map((y, j) => (j === i ? { ...y, category: e.target.value, touched: true } : y)) }))}>
                        {categories.map(c => <option key={c} value={c}>{enumLabel(c)}</option>)}
                      </select></label>
                    <label className="block"><span className="field-label">Cost</span>
                      <input inputMode="decimal" className="field-input" value={r.total_cost} placeholder="$"
                        onChange={e => setVehicle(v.id, x => ({ ...x, extra: x.extra.map((y, j) => (j === i ? { ...y, total_cost: e.target.value.replace(/[^\d.]/g, '') } : y)) }))} /></label>
                  </div>
                  <TrashButton label="Remove this line" onClick={() => setVehicle(v.id, x => ({ ...x, extra: x.extra.filter((_, j) => j !== i) }))} />
                </div>
              ))}
              <button type="button" onClick={() => setVehicle(v.id, x => ({ ...x, extra: [...x.extra, blankRecord()] }))}
                className="text-sm font-medium text-primary-700 border border-dashed border-slate-300 rounded-lg px-3 py-2 inline-flex items-center gap-1">
                <Plus size={14} /> Work done that wasn't planned
              </button>
            </section>
          )
        })}

        {/* ── Found something new? ── */}
        <section className="card space-y-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Found something new?</h2>
            <p className="text-xs text-slate-500">
              New items get their own source: the visit logged here, or “Found during {s.title}” if nothing was logged for that vehicle.
            </p>
          </div>
          {form.findings.map((f, i) => (
            <div key={i} className="border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <label className="block"><span className="field-label">What was found</span>
                  <input className="field-input" value={f.title} placeholder="e.g. Torn CV boot — front passenger side"
                    onChange={e => setFinding(i, { title: e.target.value })} /></label>
                <TrashButton label="Remove this finding" onClick={() => setForm(x => ({ ...x, findings: x.findings.filter((_, j) => j !== i) }))} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="block"><span className="field-label">Vehicle</span>
                  <select className="field-select" value={f.vehicle_id} onChange={e => setFinding(i, { vehicle_id: e.target.value })}>
                    {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select></label>
                <label className="block"><span className="field-label">Priority</span>
                  <select className="field-select" value={f.priority} onChange={e => setFinding(i, { priority: e.target.value })}>
                    {Object.entries(PRIORITY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                  </select></label>
                <label className="block"><span className="field-label">Assign</span>
                  <select className="field-select" value={f.assigned_to} onChange={e => setFinding(i, { assigned_to: e.target.value })}>
                    <option value="">Unassigned</option>
                    {Object.values(people).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
                      .map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </select></label>
                <label className="block"><span className="field-label">Plan</span>
                  <select className="field-select" value={f.session_id} onChange={e => setFinding(i, { session_id: e.target.value })}>
                    <option value="">Later</option>
                    {otherSessions.map(x => <option key={x.id} value={x.id}>{sessionLabel(x)}</option>)}
                  </select></label>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setForm(x => ({ ...x, findings: [...x.findings, blankFinding(vehicles[0]?.id)] }))}
            disabled={!vehicles.length}
            className="text-sm font-medium text-primary-700 border border-dashed border-slate-300 rounded-lg px-3 py-2 inline-flex items-center gap-1">
            <Plus size={14} /> Add a finding
          </button>
        </section>

        {/* ── Summary ── */}
        <section className="card border-primary-200 space-y-3">
          {missing.length
            ? <p className="text-sm font-semibold text-amber-800 flex items-start gap-1.5"><AlertCircle size={16} className="shrink-0 mt-0.5" />
                Choose what happened for: {missing.map(x => x.si.pending_work.title).join(', ')}</p>
            : <p className="text-sm font-semibold text-green-700 flex items-center gap-1.5"><CheckCircle2 size={16} /> Every planned item has an outcome</p>}
          {badNext.length > 0 && (
            <p className="text-sm text-amber-800">Pick the session to move {badNext.map(x => `“${x.si.pending_work.title}”`).join(', ')} into.</p>
          )}
          <ul className="text-sm text-slate-700 space-y-0.5 list-disc pl-5">
            <li>{visitsFor.length ? `Saves ${visitsFor.length} visit${visitsFor.length > 1 ? 's' : ''} (${visitsFor.map(v => v.name).join(', ')})` : 'No visit — nothing was logged'}</li>
            {count('done') > 0 && <li>{count('done')} item{count('done') > 1 ? 's' : ''} closed</li>}
            {count('partial') > 0 && <li>{count('partial')} partly done</li>}
            {count('not_done') > 0 && <li>{count('not_done')} not done</li>}
            {moved > 0 && <li>{moved} moved to another session</li>}
            {count('dropped') > 0 && <li>{count('dropped')} no longer needed (cancelled)</li>}
            {findings.length > 0 && <li>{findings.length} new item{findings.length > 1 ? 's' : ''} found</li>}
            <li>Session marked closed</li>
          </ul>
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={() => navigate(-1)} className="btn-secondary">Cancel</button>
            <button type="button" onClick={save} disabled={busy || missing.length > 0 || badNext.length > 0} className="btn-primary">
              {busy ? 'Saving…' : 'Save & close session'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

// ── One planned item ─────────────────────────────────────────────────────────

function ItemOutcome({ si, st, set, categories, otherSessions, personName }) {
  const p  = si.pending_work
  const pr = PRIORITY_META[p.priority]
  const setRecord = patch => set({ record: { ...st.record, ...patch } })
  const setNext   = patch => set({ next: { ...st.next, ...patch } })

  return (
    <div className="border border-slate-200 rounded-xl p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-slate-800">{p.title}</span>{' '}
          {pr && <span className={pr.badge}>{pr.label}</span>}
        </div>
        {!st.locked && (
          <div role="group" aria-label={`What happened with ${p.title}`} className="inline-flex flex-wrap rounded-lg border border-slate-300 overflow-hidden">
            {OUTCOMES.map(k => (
              <button key={k} type="button" aria-pressed={st.outcome === k} onClick={() => set({ outcome: k })}
                className={`px-3 py-2 text-xs font-semibold border-r border-slate-200 last:border-r-0 ${
                  st.outcome === k
                    ? (k === 'done' ? 'bg-green-700 text-white' : k === 'partial' ? 'bg-amber-700 text-white' : 'bg-slate-700 text-white')
                    : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
                {OUTCOME_META[k].label}
              </button>
            ))}
          </div>
        )}
      </div>

      {st.locked && (
        <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
          Already {p.status} — nothing more to log; it's recorded as {OUTCOME_META[st.outcome].label.toLowerCase()} for this session.
        </p>
      )}

      {!st.locked && ['done', 'partial'].includes(st.outcome) && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
          <p className={`text-xs font-semibold ${st.outcome === 'done' ? 'text-green-800' : 'text-amber-800'}`}>
            {st.outcome === 'done'
              ? 'Logged as a service record that resolves this item'
              : st.next.kind === 'split'
                ? 'Logged as a service record that resolves this item — the rest becomes a new item'
                : "Logged as a service record that doesn't resolve the item — it stays open"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-2">
            <label className="block"><span className="field-label">Record</span>
              <input className="field-input" value={st.record.title} onChange={e => setRecord({ title: e.target.value })} /></label>
            <label className="block"><span className="field-label">Category</span>
              <select className="field-select" value={st.record.category} onChange={e => setRecord({ category: e.target.value })}>
                {categories.map(c => <option key={c} value={c}>{enumLabel(c)}</option>)}
              </select></label>
            <label className="block"><span className="field-label">Cost</span>
              <input inputMode="decimal" className="field-input" value={st.record.total_cost} placeholder="$"
                onChange={e => setRecord({ total_cost: e.target.value.replace(/[^\d.]/g, '') })} /></label>
          </div>
        </div>
      )}

      {!st.locked && ['partial', 'not_done', 'dropped'].includes(st.outcome) && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
          <label className="block">
            <span className="field-label">
              {st.outcome === 'partial' ? "What's left?" : st.outcome === 'not_done' ? 'Why not? (optional)' : 'Why? (optional)'}
            </span>
            <input className="field-input" value={st.note} onChange={e => set({ note: e.target.value })}
              placeholder={st.outcome === 'partial' ? 'e.g. Rear pair — recheck at next rotation' : st.outcome === 'not_done' ? 'e.g. Parts out of stock' : ''} />
          </label>
          {st.outcome !== 'dropped' && (
            <fieldset className="flex flex-col gap-1.5 text-sm">
              <legend className="field-label">Then</legend>
              <label className="flex items-center gap-2">
                <input type="radio" checked={st.next.kind === 'lane'} onChange={() => setNext({ kind: 'lane' })} />
                Back to {personName ? `${personName}'s` : 'the'} Later list
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <input type="radio" checked={st.next.kind === 'session'} onChange={() => setNext({ kind: 'session' })} />
                Move to session
                <select className="field-select w-auto text-sm py-1" value={st.next.session_id}
                  onChange={e => setNext({ kind: 'session', session_id: e.target.value })}>
                  <option value="">— pick —</option>
                  {otherSessions.map(x => <option key={x.id} value={x.id}>{sessionLabel(x)}</option>)}
                </select>
              </label>
              {st.outcome === 'partial' && (
                <label className="flex items-center gap-2">
                  <input type="radio" checked={st.next.kind === 'split'} onChange={() => setNext({ kind: 'split' })} />
                  Split the rest off as its own item
                </label>
              )}
            </fieldset>
          )}
        </div>
      )}
    </div>
  )
}

function TrashButton({ label, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-md border border-slate-200
                 text-slate-500 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors">
      <Trash2 size={15} />
    </button>
  )
}
