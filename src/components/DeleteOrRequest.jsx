/**
 * DeleteOrRequest — drop-in replacement for a page's Delete button.
 *
 *   admin  → confirm, then the page's own onDelete (unchanged behaviour).
 *            If a family member asked for this row to be deleted, shows
 *            who asked and why next to the button.
 *   member → "Request deletion" with a reason; Joe approves from the
 *            Changes page. RLS blocks member deletes anyway — this is the UX.
 *
 * When the admin actually deletes the row, the audit_row() trigger marks
 * the pending request approved.
 */
import { useState } from 'react'
import { Trash2, Flag, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { usePendingDeletion, useRequestDeletion, useProfiles } from '@/lib/changeLog'

/** "Ben asked to delete: “duplicate”" — for pages with their own admin delete UI. */
export function PendingDeletionBadge({ table, rowId }) {
  const { data: pending } = usePendingDeletion(table, rowId)
  const { data: people = {} } = useProfiles()
  if (!pending) return null
  return (
    <span className="badge-amber" title={pending.reason}>
      <Flag size={10} className="inline mr-0.5" />
      {people[pending.requested_by]?.display_name || 'Someone'} asked to delete: “{pending.reason}”
    </span>
  )
}

export default function DeleteOrRequest({
  table, rowId, label, vehicleId, link,
  onDelete, confirmText = 'Delete this item? This cannot be undone.',
  disabled = false, className = 'btn-danger', children,
}) {
  const { isAdmin } = useAuth()
  const { data: pending } = usePendingDeletion(table, rowId)
  const request = useRequestDeletion()
  const [open, setOpen]     = useState(false)
  const [reason, setReason] = useState('')

  if (isAdmin) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <PendingDeletionBadge table={table} rowId={rowId} />
        <button
          type="button"
          disabled={disabled}
          onClick={() => { if (window.confirm(confirmText)) onDelete() }}
          className={`${className} disabled:opacity-60`}
        >
          {children ?? <><Trash2 size={14} className="inline mr-1" />Delete</>}
        </button>
      </span>
    )
  }

  if (pending) {
    return (
      <span className="badge-amber self-center" title={pending.reason}>
        <Flag size={10} className="inline mr-0.5" /> Deletion requested
      </span>
    )
  }

  async function submit(e) {
    e.preventDefault()
    if (!reason.trim()) return
    await request.mutateAsync({ table, rowId, label, vehicleId, link: link ?? window.location.pathname + window.location.search, reason: reason.trim() })
    setOpen(false)
    setReason('')
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"
      >
        <Flag size={14} className="inline mr-1" />Request deletion
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
             onClick={() => setOpen(false)}>
          <form onSubmit={submit} onClick={e => e.stopPropagation()}
                className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Request deletion</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            {label && <p className="text-sm text-slate-600">{label}</p>}
            <div>
              <label className="field-label">Why should this be deleted? *</label>
              <textarea className="field-textarea" rows={3} autoFocus
                placeholder="e.g. Duplicate — I entered this visit twice"
                value={reason} onChange={e => setReason(e.target.value)} required />
            </div>
            {request.error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{request.error.message}</p>
            )}
            <p className="text-xs text-slate-400">Joe will review it on the Changes page.</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={request.isPending || !reason.trim()} className="btn-primary disabled:opacity-60">
                {request.isPending ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
