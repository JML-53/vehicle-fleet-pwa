/**
 * PendingSheets — the actions behind a pending card's "More" menu (item 32).
 *
 *   split  → SplitPendingSheet   one item → separate items (each keeps every source)
 *   merge  → MergePendingSheet   fold a duplicate into this item
 *   wait   → WaitingOnSheet      "waiting on" another item (after | only if it fails)
 *   done   → CompletePendingSheet (item 23)
 *
 * PendingActionSheet picks one from { action, item } so pages hold one state.
 */
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, Plus, Trash2 } from 'lucide-react'
import { useProfiles } from '@/lib/changeLog'
import {
  PRIORITY_META, CLOSED, useVehiclePendingWork, useFleetPendingWork, usePendingItem,
  splitItem, mergeItems, addWaitingOn, removeWaitingOn, invalidatePending, waitingInfo,
} from '@/lib/pendingWork'
import CompletePendingSheet from '@/components/CompletePendingSheet'

export default function PendingActionSheet({ action, item, onClose }) {
  if (!action || !item) return null
  if (action === 'done')  return <CompletePendingSheet item={item} onClose={onClose} />
  if (action === 'split') return <SplitPendingSheet item={item} onClose={onClose} />
  if (action === 'merge') return <MergePendingSheet item={item} onClose={onClose} />
  if (action === 'wait')  return <WaitingOnSheet item={item} onClose={onClose} />
  return null
}

export const PENDING_ACTIONS = [
  ['split', 'Split into separate items…'],
  ['merge', 'Merge a duplicate into this…'],
  ['wait',  'Waiting on…'],
]

// ── Shell ────────────────────────────────────────────────────────────────────

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

function useRun(item, onClose) {
  const qc = useQueryClient()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  async function run(fn, { close = true } = {}) {
    setBusy(true); setError('')
    try { await fn(); invalidatePending(qc, item.vehicle_id); if (close) onClose() }
    catch (e) { setError(e.message || 'Something went wrong') }
    finally { setBusy(false) }
  }
  return { busy, error, run }
}

const ErrorBox = ({ error }) => error
  ? <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p> : null

const sourceLabels = item => (item.source_links || []).map(l => l.source?.label).filter(Boolean)

// ── Split ────────────────────────────────────────────────────────────────────

function SplitPendingSheet({ item, onClose }) {
  const { data: people = {} } = useProfiles()
  const { busy, error, run } = useRun(item, onClose)
  const blank = { title: '', assigned_to: '', priority: item.priority, due_date: item.due_date || '' }
  const [pieces, setPieces] = useState([
    { title: item.title, assigned_to: item.assigned_to || '', priority: item.priority, due_date: item.due_date || '' },
    { ...blank },
  ])
  const sortedPeople = Object.values(people).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
  const set = (i, patch) => setPieces(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const ready = pieces.every(p => p.title.trim())
  const labels = sourceLabels(item)
  const fromInspection = (item.source_links || []).some(l => l.source?.kind === 'inspection')

  return (
    <Sheet title="Split into separate items" subtitle={`${item.title}`} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button type="button" disabled={!ready || busy} className="btn-primary flex-[2]"
          onClick={() => run(() => splitItem(item.id, pieces.map(p => ({ ...p, title: p.title.trim() }))))}>
          {busy ? 'Splitting…' : `Split into ${pieces.length} items`}
        </button>
      </>}>
      {labels.length > 0 && (
        <p className="text-sm bg-primary-50 text-primary-900 rounded-lg px-3 py-2">
          Every piece keeps the source{labels.length > 1 ? 's' : ''} <strong>{labels.join(' + ')}</strong>
          {fromInspection ? ', so it still shows on the inspection and a passing re-test closes all of them.' : '.'}
        </p>
      )}
      <ErrorBox error={error} />
      {pieces.map((p, i) => (
        <fieldset key={i} className="border border-slate-200 rounded-xl p-3 space-y-2">
          <legend className="sr-only">Piece {i + 1}</legend>
          <div className="flex items-center justify-between text-xs">
            <strong className="text-slate-700">Piece {i + 1}</strong>
            {i === 0
              ? <span className="text-slate-500">keeps this item's history &amp; links</span>
              : pieces.length > 2 && (
                <button type="button" onClick={() => setPieces(ps => ps.filter((_, j) => j !== i))}
                  className="text-slate-400 hover:text-red-600 inline-flex items-center gap-1 p-1"><Trash2 size={12} /> Remove</button>
              )}
          </div>
          <label className="block">
            <span className="field-label">Title</span>
            <input className="field-input" value={p.title} onChange={e => set(i, { title: e.target.value })}
              placeholder={i === 0 ? '' : 'e.g. Tires'} autoFocus={i === 1} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="field-label">Assigned to</span>
              <select className="field-select" value={p.assigned_to} onChange={e => set(i, { assigned_to: e.target.value })}>
                <option value="">— nobody —</option>
                {sortedPeople.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Priority</span>
              <select className="field-select" value={p.priority} onChange={e => set(i, { priority: e.target.value })}>
                {Object.entries(PRIORITY_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Due</span>
              <input type="date" className="field-input" value={p.due_date} onChange={e => set(i, { due_date: e.target.value })} />
            </label>
          </div>
        </fieldset>
      ))}
      <button type="button" onClick={() => setPieces(ps => [...ps, { ...blank }])}
        className="w-full border border-dashed border-slate-300 text-primary-700 rounded-xl py-2.5 text-sm font-medium inline-flex items-center justify-center gap-1">
        <Plus size={14} /> Add another piece
      </button>
    </Sheet>
  )
}

// ── Merge ────────────────────────────────────────────────────────────────────

function MergePendingSheet({ item, onClose }) {
  const { data = [], isLoading } = useVehiclePendingWork(item.vehicle_id)
  const { busy, error, run } = useRun(item, onClose)
  const [pick, setPick] = useState('')
  const others = data.filter(i => i.id !== item.id && !CLOSED.includes(i.status))
  const chosen = others.find(i => i.id === pick)

  return (
    <Sheet title="Merge a duplicate into this item" subtitle={`Keeps: ${item.title}`} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button type="button" disabled={!pick || busy} className="btn-primary flex-[2]"
          onClick={() => run(() => mergeItems(item.id, pick))}>
          {busy ? 'Merging…' : 'Merge into this item'}
        </button>
      </>}>
      <p className="text-sm text-slate-600">
        Pick the duplicate. It's cancelled; its sources, service records and "waiting on" links move here,
        and this item keeps the higher priority and the earlier due date.
      </p>
      <ErrorBox error={error} />
      {isLoading && <p className="text-sm text-slate-400 animate-pulse">Loading…</p>}
      {!isLoading && !others.length && <p className="text-sm text-slate-400">No other open items on this vehicle.</p>}
      <div className="space-y-1">
        {others.map(o => (
          <label key={o.id}
            className={`flex items-start gap-3 rounded-lg px-3 py-2.5 border cursor-pointer ${pick === o.id ? 'border-primary-400 bg-primary-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <input type="radio" name="merge" className="mt-1" checked={pick === o.id} onChange={() => setPick(o.id)} />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800">{o.title}</span>
              <span className="block text-xs text-slate-500 truncate">
                {PRIORITY_META[o.priority]?.label ?? o.priority}
                {sourceLabels(o).length > 0 && ` · from ${sourceLabels(o).join(' + ')}`}
              </span>
            </span>
          </label>
        ))}
      </div>
      {chosen && (
        <p className="text-xs text-slate-500">“{chosen.title}” will be cancelled with a note saying it was merged here.</p>
      )}
    </Sheet>
  )
}

// ── Waiting on ───────────────────────────────────────────────────────────────

function WaitingOnSheet({ item: opened, onClose }) {
  // The sheet stays open while links are added/removed — read the live item
  const { data: live } = usePendingItem(opened.id)
  const item = live ?? opened
  const { data = [], isLoading } = useFleetPendingWork()
  const { busy, error, run } = useRun(item, onClose)
  const [pick, setPick] = useState('')
  const [kind, setKind] = useState('after')
  const current = waitingInfo(item)
  const already = new Set((item.waits_on || []).map(d => d.blocker?.id))

  // Same vehicle first, then the rest of the fleet
  const options = useMemo(() => data
    .filter(o => o.id !== item.id && !already.has(o.id) && !CLOSED.includes(o.status))
    .sort((a, b) => (b.vehicle_id === item.vehicle_id) - (a.vehicle_id === item.vehicle_id)
      || (a.vehicles?.name || '').localeCompare(b.vehicles?.name || '') || a.title.localeCompare(b.title)),
  [data, item]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet title="Waiting on" subtitle={item.title} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Done</button>
        <button type="button" disabled={!pick || busy} className="btn-primary flex-[2]"
          onClick={() => run(async () => { await addWaitingOn(item.id, pick, kind); setPick('') }, { close: false })}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </>}>
      <ErrorBox error={error} />
      {current.length > 0 && (
        <div className="space-y-1">
          {current.map(w => (
            <div key={w.id} className="flex items-center gap-2 text-sm">
              <span className={`${w.badge} whitespace-normal`}>{w.text}</span>
              <button type="button" disabled={busy} onClick={() => run(() => removeWaitingOn(w.id), { close: false })}
                aria-label="Remove" className="text-slate-300 hover:text-red-500 p-1.5"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <label className="block">
        <span className="field-label">This item waits on…</span>
        <select className="field-select" value={pick} onChange={e => setPick(e.target.value)} disabled={isLoading}>
          <option value="">{isLoading ? 'Loading…' : '— pick an open item —'}</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>{o.vehicle_id === item.vehicle_id ? '' : `${o.vehicles?.name}: `}{o.title}</option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-1.5 text-sm">
        <legend className="field-label">When can it start?</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="kind" className="mt-1" checked={kind === 'after'} onChange={() => setKind('after')} />
          <span>After that item is done <span className="block text-xs text-slate-500">e.g. alignment after control arms</span></span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="kind" className="mt-1" checked={kind === 'only_if_fails'} onChange={() => setKind('only_if_fails')} />
          <span>Only if that item doesn't fix the problem <span className="block text-xs text-slate-500">e.g. coil #3 only if new plugs &amp; wires don't stop the misfire</span></span>
        </label>
      </fieldset>
    </Sheet>
  )
}
