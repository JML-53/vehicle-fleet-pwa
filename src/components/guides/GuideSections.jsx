/**
 * Pieces of a guide (item 29, phase 1b), shared by the guide page, check-off
 * mode and the mechanic's guide card.
 */
import { Link } from 'react-router-dom'
import { AlertTriangle, Lightbulb, ExternalLink, ShieldAlert } from 'lucide-react'
import { SPEC_SOURCE_LABEL, hostname } from '@/lib/mechanic'
import { DIFFICULTY_META } from '@/lib/guides'

/**
 * One guide in a list: the vehicle's Guides tab and the fleet-wide Guides page.
 * label = small line above the title (the vehicle, or the topic).
 */
export function GuideListItem({ guide: g, label }) {
  const diff = DIFFICULTY_META[g.body?.difficulty]
  const runs = g.guide_runs || []
  return (
    <Link to={`/guides/${g.id}`} className="card block hover:border-primary-500 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {label && <p className="text-xs text-slate-400">{label}</p>}
          <p className="font-semibold text-sm text-slate-800">{g.title}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
          {runs.some(r => r.status === 'active') && <span className="badge-blue">in progress</span>}
          {g.verified_at ? <span className="badge-green">worked as written</span> : <span className="badge-amber">not yet verified</span>}
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-1">
        {diff && `${diff.label} · `}{g.body?.time_estimate && `${g.body.time_estimate} · `}
        {(g.body?.steps || []).length} steps · version {g.version} · {runs.length} job{runs.length === 1 ? '' : 's'}
      </p>
    </Link>
  )
}

/** Size and torque chips, caution and tip — shown at the step where they're needed */
export function StepBody({ step, large = false }) {
  return (
    <div className="space-y-2">
      <p className={`${large ? 'text-base' : 'text-sm'} text-slate-700 leading-relaxed whitespace-pre-wrap`}>{step.detail}</p>
      {(step.size || step.torque) && (
        <div className="flex flex-wrap gap-2">
          {step.size && (
            <span className={`inline-flex items-center rounded-lg bg-slate-100 text-slate-800 font-semibold ${large ? 'text-base px-3 py-1.5' : 'text-xs px-2 py-1'}`}>
              {step.size}
            </span>
          )}
          {step.torque && (
            <span className={`inline-flex items-center rounded-lg bg-primary-50 text-primary-800 font-bold ${large ? 'text-base px-3 py-1.5' : 'text-xs px-2 py-1'}`}>
              {step.torque}
            </span>
          )}
        </div>
      )}
      {step.caution && (
        <p className="flex gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />{step.caution}
        </p>
      )}
      {step.tip && (
        <p className="flex gap-2 text-sm bg-blue-50 border border-blue-100 text-blue-900 rounded-lg px-3 py-2">
          <Lightbulb size={15} className="shrink-0 mt-0.5" />{step.tip}
        </p>
      )}
    </div>
  )
}

/** Tools (with sizes), parts, supplies and safety */
export function BeforeYouStart({ body }) {
  const { tools = [], parts = [], supplies = [], safety = [] } = body ?? {}
  return (
    <div className="space-y-3 text-sm">
      {tools.length > 0 && (
        <div>
          <p className="font-semibold text-slate-700 mb-1">Tools</p>
          <ul className="space-y-1">
            {tools.map((t, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="text-slate-800">{t.name}</span>
                {t.size && <span className="font-semibold text-primary-800">{t.size}</span>}
                {t.note && <span className="text-slate-500">— {t.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {parts.length > 0 && (
        <div>
          <p className="font-semibold text-slate-700 mb-1">Parts</p>
          <ul className="space-y-1">
            {parts.map((p, i) => (
              <li key={i} className="text-slate-800">
                {[p.quantity, p.brand, p.name].filter(Boolean).join(' ')}
                {p.part_number && <span className="font-mono text-xs text-slate-600"> #{p.part_number}</span>}
                {p.note && <span className="text-slate-500"> — {p.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {supplies.length > 0 && (
        <div>
          <p className="font-semibold text-slate-700 mb-1">Shop supplies</p>
          <p className="text-slate-800">{supplies.map(s => s.quantity ? `${s.name} (${s.quantity})` : s.name).join(' · ')}</p>
        </div>
      )}
      {safety.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <p className="font-semibold text-red-800 mb-1 flex items-center gap-1"><ShieldAlert size={14} /> Safety</p>
          <ul className="list-disc pl-5 space-y-0.5 text-red-900">{safety.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

export function BulletSection({ title, items }) {
  if (!items?.length) return null
  return (
    <div className="card">
      <h2 className="card-header">{title}</h2>
      <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </div>
  )
}

export function GuideSpecList({ specs }) {
  if (!specs?.length) return null
  return (
    <table className="data-table">
      <tbody>
        {specs.map((s, i) => (
          <tr key={i}>
            <td className="text-slate-600">{s.name}<span className="block text-xs text-slate-400">{s.category}</span></td>
            <td className="font-semibold text-slate-800">
              {s.value}{s.units ? ` ${s.units}` : ''}
              <span className="block text-xs font-normal text-slate-500">
                from {SPEC_SOURCE_LABEL[s.source_type] ?? s.source_type}
                {s.source_ref && (/^https?:\/\//.test(s.source_ref)
                  ? <> · <a href={s.source_ref} target="_blank" rel="noopener noreferrer" className="underline">{hostname(s.source_ref)}</a></>
                  : <> · {s.source_ref}</>)}
                {s.safety_critical && <span className="text-red-700"> · safety-critical</span>}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function GuideSources({ sources }) {
  if (!sources?.length) return null
  return (
    <ul className="space-y-1">
      {sources.map((s, i) => (
        <li key={i} className="text-sm">
          {/^https?:\/\//.test(s.url)
            ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-700 hover:underline">
                {s.title || hostname(s.url)} <ExternalLink size={11} /></a>
            : <span className="text-slate-700">{s.title}{s.url ? ` — ${s.url}` : ''}</span>}
        </li>
      ))}
    </ul>
  )
}
