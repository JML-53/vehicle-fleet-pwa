/**
 * AlsoFoundPanel — the extra things the AI found in a document (items 9.3, 9.4),
 * shown on the review screen as checkboxes. Ticked items are created on Save;
 * see applyFindings in src/lib/documentImport.js.
 *
 * value: { inspection: {...include} | null, codes: [{...include}], work: [{...include, match}] }
 */
import { ShieldCheck, ShieldX, Cpu, ClipboardList, Sparkles } from 'lucide-react'
import { PRIORITY_META } from '@/lib/pendingWork'

export default function AlsoFoundPanel({ value, onChange }) {
  if (!value) return null
  const { inspection, codes = [], work = [] } = value
  if (!inspection && !codes.length && !work.length) return null

  const set = patch => onChange({ ...value, ...patch })
  const setAt = (key, i, patch) => set({ [key]: value[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const failed = inspection?.result === 'fail'

  return (
    <div className="card space-y-4 border border-amber-200 bg-amber-50/40">
      <h2 className="card-header mb-0 flex items-center gap-1.5 text-amber-800">
        <Sparkles size={14} /> Also found in this document
      </h2>
      <p className="text-xs text-slate-500 -mt-2">Ticked items are added when you save. Untick anything that's wrong.</p>

      {inspection && (
        <section className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={!!inspection.include}
              onChange={e => set({ inspection: { ...inspection, include: e.target.checked } })} />
            <span className="flex-1">
              <span className={`inline-flex items-center gap-1 font-medium ${failed ? 'text-purple-800' : 'text-green-800'}`}>
                {failed ? <ShieldX size={14} /> : <ShieldCheck size={14} />}
                Log {inspection.inspection_type} inspection: {failed ? 'FAILED' : 'passed'}
              </span>
              <span className="block text-xs text-slate-500">
                {inspection.inspection_date || 'visit date'}
                {inspection.report_number && ` · report ${inspection.report_number}`}
                {' · '}updates the Inspections tab{failed ? ' and creates a repair item per line below' : ''}
              </span>
            </span>
          </label>
          {inspection.include && failed && (
            <textarea className="field-textarea text-sm bg-white ml-6 w-[calc(100%-1.5rem)]" rows={3}
              placeholder={'Repairs needed to pass — one per line, e.g.\nParking brake\nFront tires'}
              value={inspection.repairs || ''}
              onChange={e => set({ inspection: { ...inspection, repairs: e.target.value } })} />
          )}
        </section>
      )}

      {codes.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
            <Cpu size={11} /> Trouble codes → Diagnostics
          </p>
          {codes.map((c, i) => (
            <label key={i} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={!!c.include}
                onChange={e => setAt('codes', i, { include: e.target.checked })} />
              <span><span className="font-mono font-medium">{c.code}</span>
                {c.description && <span className="text-slate-600"> · {c.description}</span>}</span>
            </label>
          ))}
        </section>
      )}

      {work.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
            <ClipboardList size={11} /> Recommended work → Pending Work
          </p>
          {work.map((w, i) => {
            const pr = PRIORITY_META[w.priority] ?? { label: w.priority, badge: 'badge-slate' }
            return (
              <label key={i} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={!!w.include}
                  onChange={e => setAt('work', i, { include: e.target.checked })} />
                <span className="flex-1">
                  <span className="font-medium text-slate-800">{w.title}</span>{' '}
                  <span className={pr.badge} style={{ fontSize: '10px' }}>{pr.label}</span>
                  {w.description && <span className="block text-xs text-slate-500">{w.description}</span>}
                  {w.match && (
                    <span className="block text-xs text-blue-700">
                      Already tracked as “{w.match.title}”, so it's unticked to avoid a duplicate.
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </section>
      )}
    </div>
  )
}
