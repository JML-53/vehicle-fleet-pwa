/**
 * SessionSheets — planning work sessions (item 32 phase 2b).
 *
 *   PlanSessionSheet    "+ Plan a session": who / when / where + tick open items
 *   SessionPickerSheet  one item's "Plan in a session…": add, move, remove, or new
 *   AddItemsSheet       session page "Add items…"
 *   SessionFields       the title / date / person / shop fields they share
 *
 * New items are never planned automatically; they wait in their person's Later
 * list until someone puts them in a session.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { X, Plus, Trash2 } from 'lucide-react'
import { useProfiles } from '@/lib/changeLog'
import { PRIORITY_META, CLOSED, useFleetPendingWork, useShopsList, plannedSession, dueInfo, priorityRank } from '@/lib/pendingWork'
import {
  useWorkSessions, createSession, addItemsToSession, moveItemToSession, removeSessionItem,
  cancelSession, invalidateSessions, sessionLabel,
} from '@/lib/workSessions'

// ── Shared bits ──────────────────────────────────────────────────────────────

function Sheet({ title, subtitle, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={title}
        className="absolute bottom-0 left-0 right-0 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-lg sm:bottom-6
                   bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between px-5 pt-4 pb-2 gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800">{title}</p>
            {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 p-2 -m-1"><X size={18} /></button>
        </div>
        <div className="px-5 pb-3 overflow-y-auto flex-1 min-h-0 space-y-3">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 flex gap-2">{footer}</div>}
      </div>
    </div>
  )
}

const ErrorBox = ({ error }) => error
  ? <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p> : null

export const blankSession = (assignedTo = '') => ({ title: '', planned_date: '', assigned_to: assignedTo, shop_id: '', notes: '' })

/** Title / date / person / shop (shop blank = DIY). */
export function SessionFields({ value, onChange }) {
  const { data: people = {} } = useProfiles()
  const { data: shops = [] } = useShopsList()
  const set = patch => onChange({ ...value, ...patch })
  const sortedPeople = Object.values(people).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="field-label">Session name *</span>
        <input className="field-input" value={value.title} onChange={e => set({ title: e.target.value })}
          placeholder="e.g. NTB — tires, Driveway day" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="field-label">Date</span>
          <input type="date" className="field-input" value={value.planned_date} onChange={e => set({ planned_date: e.target.value })} />
          <span className="text-[11px] text-slate-400">Blank = not booked yet</span>
        </label>
        <label className="block">
          <span className="field-label">Who</span>
          <select className="field-select" value={value.assigned_to} onChange={e => set({ assigned_to: e.target.value })}>
            <option value="">— nobody yet —</option>
            {sortedPeople.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="field-label">Where</span>
        <select className="field-select" value={value.shop_id} onChange={e => set({ shop_id: e.target.value })}>
          <option value="">DIY (at home)</option>
          {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
    </div>
  )
}

/** Open items that aren't in a planned session yet, grouped by vehicle, as checkboxes. */
function ItemChecklist({ selected, onToggle, exclude = new Set() }) {
  const { data = [], isLoading } = useFleetPendingWork()
  const [vehicle, setVehicle] = useState('all')
  const open = data.filter(i => !CLOSED.includes(i.status) && !plannedSession(i) && !exclude.has(i.id))
  const vehicles = useMemo(() => {
    const m = new Map()
    for (const i of open) m.set(i.vehicle_id, i.vehicles?.name || 'Unknown vehicle')
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [open])
  const shown = open
    .filter(i => vehicle === 'all' || i.vehicle_id === vehicle)
    .sort((a, b) => (a.vehicles?.name || '').localeCompare(b.vehicles?.name || '') || priorityRank(a.priority) - priorityRank(b.priority))

  if (isLoading) return <p className="text-sm text-slate-400 animate-pulse">Loading…</p>
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="field-label mb-0">Items ({selected.size} picked)</span>
        <select aria-label="Vehicle" className="field-select w-auto text-xs py-1" value={vehicle} onChange={e => setVehicle(e.target.value)}>
          <option value="all">All vehicles</option>
          {vehicles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      {!shown.length && <p className="text-sm text-slate-400">Nothing open that isn't already planned.</p>}
      <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
        {shown.map(i => {
          const due = dueInfo(i)
          return (
            <label key={i.id} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
              <input type="checkbox" className="mt-1" checked={selected.has(i.id)} onChange={() => onToggle(i.id)} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-800">{i.title}</span>
                <span className="flex flex-wrap gap-1 mt-0.5 text-xs text-slate-500">
                  <span>{i.vehicles?.name}</span>
                  <span className={PRIORITY_META[i.priority]?.badge ?? 'badge-slate'}>{PRIORITY_META[i.priority]?.label ?? i.priority}</span>
                  {due && <span className={due.badge}>{due.label}</span>}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function useBusy() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(fn) {
    setBusy(true); setError('')
    try { return await fn() }
    catch (e) { setError(e.message || 'Something went wrong'); return undefined }
    finally { setBusy(false) }
  }
  return { busy, error, run }
}

const toggleIn = setter => id => setter(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

/**
 * After taking an item out of a session: if that left it empty, offer to cancel it
 * (an empty planned session is otherwise left behind on the Pending Work page).
 * `remaining` = planned items still in the session after the removal.
 */
export async function offerCancelIfEmpty(session, remaining) {
  if (remaining > 0 || !session) return false
  if (!confirm(`“${session.title}” has no other items now. Cancel the session too?`)) return false
  await cancelSession(session.id)
  return true
}

// ── Plan a session ───────────────────────────────────────────────────────────

export function PlanSessionSheet({ onClose, defaultPerson = '' }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { busy, error, run } = useBusy()
  const [fields, setFields] = useState(blankSession(defaultPerson))
  const [picked, setPicked] = useState(new Set())

  const save = () => run(async () => {
    const id = await createSession(fields, [...picked])
    invalidateSessions(qc)
    onClose()
    navigate(`/sessions/${id}`)
  })

  return (
    <Sheet title="Plan a session" subtitle="A trip to the shop or a work day — pick who, when and what" onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button type="button" disabled={!fields.title.trim() || busy} onClick={save} className="btn-primary flex-[2]">
          {busy ? 'Saving…' : picked.size ? `Plan with ${picked.size} item${picked.size > 1 ? 's' : ''}` : 'Plan (add items later)'}
        </button>
      </>}>
      <ErrorBox error={error} />
      <SessionFields value={fields} onChange={setFields} />
      <ItemChecklist selected={picked} onToggle={toggleIn(setPicked)} />
    </Sheet>
  )
}

// ── Add items to an existing session ─────────────────────────────────────────

export function AddItemsSheet({ session, onClose }) {
  const qc = useQueryClient()
  const { busy, error, run } = useBusy()
  const [picked, setPicked] = useState(new Set())
  const save = () => run(async () => {
    await addItemsToSession(session.id, [...picked])
    invalidateSessions(qc)
    onClose()
  })
  return (
    <Sheet title="Add items" subtitle={sessionLabel(session)} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button type="button" disabled={!picked.size || busy} onClick={save} className="btn-primary flex-[2]">
          {busy ? 'Adding…' : `Add ${picked.size || ''} item${picked.size === 1 ? '' : 's'}`}
        </button>
      </>}>
      <ErrorBox error={error} />
      <ItemChecklist selected={picked} onToggle={toggleIn(setPicked)} />
    </Sheet>
  )
}

// ── One item: plan / move / remove ───────────────────────────────────────────

export function SessionPickerSheet({ item, onClose }) {
  const qc = useQueryClient()
  const { data: sessions = [], isLoading } = useWorkSessions('planned')
  const { data: people = {} } = useProfiles()
  const { busy, error, run } = useBusy()
  const current = plannedSession(item)
  const [pick, setPick] = useState('')
  const [creating, setCreating] = useState(false)
  const [fields, setFields] = useState(blankSession(item.assigned_to || ''))
  const others = sessions.filter(s => s.id !== current?.session?.id)
  const done = () => { invalidateSessions(qc, [item.vehicle_id]); onClose() }
  // Planned items left in the current session once this one leaves it
  const leftBehind = () => {
    const s = sessions.find(x => x.id === current?.session?.id)
    return (s?.items || []).filter(x => x.outcome == null && x.pending_work?.id !== item.id).length
  }

  const save = () => run(async () => {
    if (creating) {
      const id = await createSession(fields)
      await moveItemToSession(item.id, id)
    } else {
      await moveItemToSession(item.id, pick)
    }
    if (current) await offerCancelIfEmpty(current.session, leftBehind())
    done()
  })

  return (
    <Sheet title={current ? 'Move to another session' : 'Plan in a session'} subtitle={item.title} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button type="button" disabled={busy || (creating ? !fields.title.trim() : !pick)} onClick={save} className="btn-primary flex-[2]">
          {busy ? 'Saving…' : creating ? 'Create session & add' : current ? 'Move here' : 'Add to session'}
        </button>
      </>}>
      <ErrorBox error={error} />
      {current && (
        <div className="flex items-center gap-2 text-sm bg-primary-50 rounded-lg px-3 py-2">
          <span className="flex-1 min-w-0">Now in <strong>{sessionLabel(current.session)}</strong></span>
          <button type="button" disabled={busy} title="Take it out of this session"
            onClick={() => run(async () => {
              await removeSessionItem(current.id)
              await offerCancelIfEmpty(current.session, leftBehind())
              done()
            })}
            className="inline-flex items-center gap-1 text-xs font-medium rounded-md border border-slate-200 bg-white px-2 py-1.5
                       text-slate-600 hover:text-red-600 hover:border-red-300 hover:bg-red-50">
            <Trash2 size={13} /> Remove
          </button>
        </div>
      )}

      {!creating && (
        <>
          {isLoading && <p className="text-sm text-slate-400 animate-pulse">Loading…</p>}
          {!isLoading && !others.length && <p className="text-sm text-slate-400">No other planned sessions yet.</p>}
          <div className="space-y-1">
            {others.map(s => (
              <label key={s.id}
                className={`flex items-start gap-3 rounded-lg px-3 py-2.5 border cursor-pointer ${pick === s.id ? 'border-primary-400 bg-primary-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="session" className="mt-1" checked={pick === s.id} onChange={() => setPick(s.id)} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{sessionLabel(s)}</span>
                  <span className="block text-xs text-slate-500">
                    {s.assigned_to ? people[s.assigned_to]?.display_name : 'Nobody yet'} · {s.shop?.name || 'DIY'} · {(s.items || []).filter(x => x.outcome == null).length} items
                  </span>
                </span>
              </label>
            ))}
          </div>
          <button type="button" onClick={() => setCreating(true)}
            className="w-full border border-dashed border-slate-300 text-primary-700 rounded-xl py-2.5 text-sm font-medium inline-flex items-center justify-center gap-1">
            <Plus size={14} /> New session…
          </button>
        </>
      )}
      {creating && (
        <>
          <SessionFields value={fields} onChange={setFields} />
          <button type="button" onClick={() => setCreating(false)} className="text-xs text-primary-700">← Pick an existing session instead</button>
        </>
      )}
    </Sheet>
  )
}
