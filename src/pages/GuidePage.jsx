/**
 * GuidePage — one saved job guide (item 29, phase 1b). Route: /guides/:guideId
 *
 * Read view of every section, Start job / Resume job (check-off mode at
 * /guides/:guideId/run/:runId, optionally for a pending item), "Save all specs
 * to the vehicle" (unverified, decision 2), job history, and admin delete.
 * Earlier versions live in the Changes page (guides is audited).
 */
import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, Play, MessagesSquare, CheckCircle2, BookOpen } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useProfiles } from '@/lib/changeLog'
import { useVehiclePendingWork } from '@/lib/pendingWork'
import { askMechanic } from '@/lib/mechanic'
import {
  useGuide, useGuideSavedSpecs, DIFFICULTY_META, startOrResumeRun, saveGuideSpecs, invalidateGuides,
} from '@/lib/guides'
import { StepBody, BeforeYouStart, BulletSection, GuideSpecList, GuideSources } from '@/components/guides/GuideSections'
import GuidePlayer from '@/components/guides/GuidePlayer'
import VoicePicker from '@/components/voice/VoicePicker'
import DeleteOrRequest from '@/components/DeleteOrRequest'
import { useVoice } from '@/lib/voice'

export default function GuidePage() {
  const { guideId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: g, isLoading, error } = useGuide(guideId)
  const { data: savedSpecs = [] } = useGuideSavedSpecs(guideId)
  const { data: pending = [] } = useVehiclePendingWork(g?.vehicle_id)
  const { data: people = {} } = useProfiles()
  const [forItem, setForItem] = useState(null)   // null = default (the item linked to this guide)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const voice = useVoice()                       // "Listen to this guide"

  if (isLoading) return <div className="p-4 text-slate-400 text-sm animate-pulse">Loading guide…</div>
  if (error || !g) return <div className="p-4 text-red-500 text-sm">Guide not found.</div>

  const b = g.body ?? {}
  const diff = DIFFICULTY_META[b.difficulty] ?? { label: b.difficulty, badge: 'badge-slate' }
  const runs = [...(g.guide_runs ?? [])].sort((x, y) => y.started_at.localeCompare(x.started_at))
  const active = runs.find(r => r.status === 'active')
  const linkedItem = pending.find(p => p.guide_id === g.id)
  const chosenItem = forItem ?? linkedItem?.id ?? ''
  const unsavedSpecs = (b.specs ?? []).filter(s =>
    !savedSpecs.some(x => x.spec_name.toLowerCase() === s.name.toLowerCase())
    && !(s.safety_critical && s.source_type === 'ai_knowledge'))

  async function start() {
    setBusy(true); setMsg(null)
    try {
      const runId = await startOrResumeRun(g, { pendingWorkId: chosenItem || null })
      invalidateGuides(qc, g.vehicle_id, g.id)
      navigate(`/guides/${g.id}/run/${runId}`)
    } catch (err) {
      setMsg(err.message)
      setBusy(false)
    }
  }

  async function saveSpecs() {
    setBusy(true); setMsg(null)
    try {
      const n = await saveGuideSpecs(g, savedSpecs)
      qc.invalidateQueries({ queryKey: ['known_specs'] })
      setMsg(`${n} spec${n === 1 ? '' : 's'} saved to the vehicle as unverified.`)
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const { error } = await supabase.from('guides').delete().eq('id', g.id)
    if (error) { setMsg(error.message); return }
    invalidateGuides(qc, g.vehicle_id)
    navigate(`/vehicles/${g.vehicle_id}?tab=guides`, { replace: true })
  }

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
            <ArrowLeft size={14} /> Back
          </button>
          <p className="text-xs text-primary-300 flex items-center gap-1"><BookOpen size={12} /> Guide ·{' '}
            <Link to={`/vehicles/${g.vehicle_id}?tab=guides`} className="underline">{g.vehicles?.name}</Link>
          </p>
          <h1 className="text-xl font-bold leading-tight mt-0.5">{g.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
            <span className={diff.badge}>{diff.label}</span>
            {b.time_estimate && <span className="text-primary-100">{b.time_estimate}</span>}
            <span className="text-primary-100">version {g.version}</span>
            {g.verified_at
              ? <span className="badge-green inline-flex items-center gap-1"><CheckCircle2 size={11} /> worked as written</span>
              : <span className="badge-amber">not yet verified</span>}
          </div>
        </div>
      </div>

      <div className="p-4 max-w-3xl mx-auto space-y-4 pb-10">
        {b.summary && <p className="text-sm text-slate-700">{b.summary}</p>}

        {/* 1b: listen to the whole guide — play / pause / skip, jump between sections */}
        <div className="card space-y-3">
          <h2 className="card-header mb-0">Listen to this guide</h2>
          <GuidePlayer guide={g} voice={voice} mode="listen" />
          {voice.error && <p className="text-xs text-red-600">{voice.error}</p>}
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-slate-500">Voice settings</summary>
            <div className="mt-2"><VoicePicker voice={voice} /></div>
          </details>
        </div>

        {/* Start / resume */}
        <div className="card space-y-3">
          {active ? (
            <p className="text-sm text-slate-700">A job using this guide is under way
              {active.started_by && people[active.started_by] ? ` (started by ${people[active.started_by].display_name})` : ''}.</p>
          ) : (
            <div>
              <label className="field-label">For a pending item (optional)</label>
              <select className="field-select" value={chosenItem} onChange={e => setForItem(e.target.value)}>
                <option value="">— none —</option>
                {pending.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={start} disabled={busy}
              className="btn-primary inline-flex items-center gap-1.5">
              <Play size={15} /> {active ? 'Resume job' : 'Start job'}
            </button>
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5"
              onClick={() => askMechanic(navigate, {
                vehicleId: g.vehicle_id,
                prompt: `About the guide "${g.title}": `,
                entry: { kind: 'guide', id: g.id, label: g.title },
              })}>
              <MessagesSquare size={15} /> Ask the mechanic
            </button>
          </div>
          {msg && <p className="text-sm text-slate-600">{msg}</p>}
        </div>

        <div className="card">
          <h2 className="card-header">Before you start</h2>
          <BeforeYouStart body={b} />
        </div>

        <div className="card">
          <h2 className="card-header">Steps</h2>
          <ol className="space-y-4">
            {(b.steps ?? []).map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-primary-50 text-primary-800 text-sm font-bold flex items-center justify-center">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm mb-1">{s.title}</p>
                  <StepBody step={s} />
                </div>
              </li>
            ))}
          </ol>
        </div>

        <BulletSection title="Common mistakes" items={b.mistakes} />
        <BulletSection title="Tips and trouble spots" items={b.tips} />
        <BulletSection title="After the job" items={b.after} />

        {(b.specs ?? []).length > 0 && (
          <div className="card space-y-2">
            <h2 className="card-header mb-0">Specs used</h2>
            <GuideSpecList specs={b.specs} />
            {unsavedSpecs.length > 0
              ? <button type="button" onClick={saveSpecs} disabled={busy} className="btn-secondary text-sm">
                  Save {unsavedSpecs.length} spec{unsavedSpecs.length === 1 ? '' : 's'} to the vehicle (unverified)
                </button>
              : <p className="text-xs text-green-700 flex items-center gap-1"><CheckCircle2 size={12} /> Saved on the vehicle's Specs tab.</p>}
          </div>
        )}

        {(b.sources ?? []).length > 0 && (
          <div className="card">
            <h2 className="card-header">Sources</h2>
            <GuideSources sources={b.sources} />
          </div>
        )}

        {runs.length > 0 && (
          <div className="card">
            <h2 className="card-header">Job history</h2>
            <ul className="divide-y divide-slate-100">
              {runs.map(r => (
                <li key={r.id} className="py-2 text-sm flex items-center justify-between gap-2">
                  <Link to={`/guides/${g.id}/run/${r.id}`} className="text-primary-700 hover:underline">
                    {format(parseISO(r.started_at), 'MMM d, yyyy')}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {people[r.started_by]?.display_name ?? ''} · v{r.guide_version} ·{' '}
                    {r.status === 'active' ? 'in progress' : r.status === 'abandoned' ? 'stopped' : r.outcome === 'as_written' ? 'worked as written' : 'done with changes'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end">
          <DeleteOrRequest table="guides" rowId={g.id} label={g.title} vehicleId={g.vehicle_id}
            confirmText="Delete this guide and its job history? Specs saved from it stay on the vehicle."
            onDelete={remove} />
        </div>
      </div>
    </div>
  )
}
