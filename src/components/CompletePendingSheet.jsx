/**
 * CompletePendingSheet — what "Mark done…" on a pending item opens (item 23).
 *
 *   Log the service visit       → visit form pre-filled + pre-linked
 *   Link to a visit already logged → pick a recent record (resolves)
 *   Done, nothing to log        → completed today, no record
 *
 * Every completion gets a date; most get a record behind them.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { X, FilePlus2, Link2, CheckCircle2, ChevronLeft } from 'lucide-react'
import {
  useRecentRecords, linkRecord, completeWithoutRecord, invalidatePending, fromPendingState,
} from '@/lib/pendingWork'

export default function CompletePendingSheet({ item, onClose, initialMode = 'choose' }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const vehicleId = item.vehicle_id
  const [mode, setMode]         = useState(initialMode)   // choose | link
  const [resolves, setResolves] = useState(true)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const { data: records = [], isLoading } = useRecentRecords(mode === 'link' ? vehicleId : null, 25)

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn(); invalidatePending(qc, vehicleId); onClose() }
    catch (e) { setError(e.message || 'Something went wrong') }
    finally { setBusy(false) }
  }

  const Option = ({ Icon, title, hint, onClick }) => (
    <button type="button" onClick={onClick} disabled={busy}
      className="w-full flex items-start gap-3 text-left px-3 py-3 rounded-lg hover:bg-slate-50 disabled:opacity-60">
      <Icon size={18} className="text-primary-600 mt-0.5 shrink-0" />
      <span>
        <span className="block text-sm font-medium text-slate-800">{title}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </button>
  )

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div onClick={e => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md sm:bottom-6
                   bg-white rounded-t-2xl sm:rounded-2xl shadow-xl pb-5 max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between px-5 pt-4 pb-2 gap-2">
          <div className="min-w-0">
            {mode === 'link' && initialMode === 'choose' && (
              <button type="button" onClick={() => setMode('choose')}
                className="text-xs text-primary-600 flex items-center gap-0.5 mb-1">
                <ChevronLeft size={12} /> Back
              </button>
            )}
            <p className="text-xs text-slate-500">{initialMode === 'link' ? 'Link a service record to' : 'Mark as done'}</p>
            <p className="font-semibold text-slate-800 truncate">{item.title}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
        </div>

        {error && <p className="mx-5 mb-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {mode === 'choose' && (
          <div className="px-2">
            <Option Icon={FilePlus2} title="Log the service visit"
              hint="Opens a visit pre-filled from this item; it's marked resolved when you save."
              onClick={() => navigate(`/vehicles/${vehicleId}/add-visit`, { state: fromPendingState(item) })} />
            <Option Icon={Link2} title="Link to a visit already logged"
              hint="Pick the service record that took care of it."
              onClick={() => setMode('link')} />
            <Option Icon={CheckCircle2} title="Done, nothing to log"
              hint="Marks it completed today without a service record."
              onClick={() => run(() => completeWithoutRecord(item.id))} />
          </div>
        )}

        {mode === 'link' && (
          <div className="px-5 flex-1 min-h-0 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={resolves} onChange={e => setResolves(e.target.checked)} />
              This resolved it <span className="text-xs text-slate-400">(untick if it was only worked on)</span>
            </label>
            <div className="overflow-y-auto flex-1 -mx-2">
              {isLoading && <p className="text-sm text-slate-400 animate-pulse px-2">Loading…</p>}
              {!isLoading && !records.length && <p className="text-sm text-slate-400 px-2">No service records for this vehicle yet.</p>}
              {records.map(r => (
                <button key={r.id} type="button" disabled={busy}
                  onClick={() => run(() => linkRecord(item.id, r.id, resolves))}
                  className="w-full text-left px-2 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-60">
                  <span className="block text-sm text-slate-800">{r.title}</span>
                  <span className="block text-xs text-slate-500">
                    {r.service_date ? format(parseISO(r.service_date), 'MMM d, yyyy') : 'no date'}
                    {r.service_visits?.shops?.name && ` · ${r.service_visits.shops.name}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
