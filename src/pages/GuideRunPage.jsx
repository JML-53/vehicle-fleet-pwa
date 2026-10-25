/**
 * GuideRunPage — doing a job with a guide: check-off mode (item 29, phase 1b).
 * Route: /guides/:guideId/run/:runId
 *
 * One step at a time in large type with Done / Back / Next, step notes, "Ask
 * about this step" (the run's own chat, so the mechanic knows where you are),
 * and the full list a tap away. Ticks are saved per step and the page polls,
 * so two people on the same job see each other's progress. The screen stays
 * awake while the page is open.
 *
 * Finish: "worked as written" verifies the guide (and offers to verify its
 * saved specs); "with changes" asks the mechanic for an updated version from
 * the step notes. Then Log the service visit for the linked pending item.
 *
 * Voice (1b): each step is read aloud as you arrive at it. Hold to talk:
 * "done / next", "back", "repeat", "skip" and "where am I" are matched on the
 * phone (instant, free); anything else is a question to the mechanic in the
 * job's chat, answered aloud in a panel here.
 */
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, StickyNote, MessagesSquare, ListChecks, Flag, Undo2, CheckCircle2,
  Volume2, VolumeX, Loader2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useStoredState } from '@/lib/useStoredState'
import { usePendingItem, fromPendingState } from '@/lib/pendingWork'
import { askMechanic, sendToMechanic } from '@/lib/mechanic'
import { useVoice, matchCommand, unlockAudio, createSentenceSplitter } from '@/lib/voice'
import TalkButton from '@/components/voice/TalkButton'
import VoicePicker from '@/components/voice/VoicePicker'
import {
  useGuide, useGuideRun, useGuideSavedSpecs, firstOpenStep, setStepDone, setStepNote, finishRun,
  verifyGuideSpecs, invalidateGuides,
} from '@/lib/guides'
import { StepBody, BeforeYouStart } from '@/components/guides/GuideSections'
import GuidePlayer from '@/components/guides/GuidePlayer'

/** The newest chat tied to this run, so "Ask about this step" continues it */
function useRunConversation(runId) {
  return useQuery({
    queryKey: ['ai_conversations', 'run', runId],
    queryFn: async () => {
      const { data, error } = await supabase.from('ai_conversations').select('id')
        .eq('guide_run_id', runId).order('last_message_at', { ascending: false }).limit(1)
      if (error) throw error
      return data[0] ?? null
    },
    enabled: !!runId,
  })
}

/** Keep the phone's screen on while a job is open (re-acquired after switching apps) */
function useWakeLock(enabled) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return
    let lock = null
    const acquire = async () => {
      try { lock = await navigator.wakeLock.request('screen') } catch { /* not allowed now; fine */ }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') acquire() }
    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [enabled])
}

export default function GuideRunPage() {
  const { guideId, runId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const { data: g } = useGuide(guideId)
  const { data: run } = useGuideRun(runId)
  const { data: chat } = useRunConversation(runId)
  const { data: savedSpecs = [] } = useGuideSavedSpecs(guideId)
  const { data: item } = usePendingItem(run?.pending_work_id)

  const steps = g?.body?.steps ?? []
  const [idx, setIdx] = useState(null)        // current step; steps.length = "after the job"
  const [showList, setShowList] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [finished, setFinished] = useState(null)   // outcome just chosen on this phone
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const isActive = run?.status === 'active'
  useWakeLock(isActive)

  const [voiceOn, setVoiceOn] = useStoredState('guide_voice_mode', false)
  const voice = useVoice()
  const [answer, setAnswer] = useState(null)       // { question, text, busy, error } from a spoken question
  const player = useRef(null)                      // GuidePlayer: reads the step on arrival; replay() for "repeat"

  // Open on the first step not yet done (once, when the run loads)
  useEffect(() => {
    if (idx === null && run && g) setIdx(firstOpenStep(run, steps.length))
  }, [run, g]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!g || !run || idx === null) return <div className="p-4 text-slate-400 text-sm animate-pulse">Loading job…</div>

  const rows = new Map((run.guide_run_steps ?? []).map(s => [s.step_index, s]))
  const doneCount = steps.filter((_, i) => rows.get(i)?.done_at).length
  const step = steps[idx]
  const row = rows.get(idx)

  const refresh = () => qc.invalidateQueries({ queryKey: ['guide_run', runId] })
  async function act(fn) {
    setBusy(true); setError(null)
    try { await fn(); await refresh() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  function markDone() {
    act(async () => {
      await setStepDone(runId, idx, true, user?.id)
      setIdx(i => Math.min(i + 1, steps.length))
      setNoteOpen(false)
    })
  }

  function openNote() {
    setNote(row?.note ?? '')
    setNoteOpen(true)
  }

  function askAboutStep() {
    askMechanic(navigate, {
      vehicleId: g.vehicle_id,
      conversationId: chat?.id,
      guideRunId: runId,
      prompt: step ? `Step ${idx + 1} (${step.title}): ` : 'About this job: ',
      entry: { kind: 'guide step', id: runId, label: `${g.title}${step ? `, step ${idx + 1}` : ''}` },
    })
  }

  function toggleVoice() {
    if (voiceOn) {
      voice.stopSpeaking()
      setVoiceOn(false)
    } else {
      unlockAudio()                 // this tap lets the phone play the steps; the player reads the current one
      setVoiceOn(true)
    }
  }

  /** Hold-to-talk released: a command handled here, or a question for the mechanic */
  function onVoice(text) {
    if (!text) { voice.speak("Sorry, I didn't catch that."); return }
    switch (matchCommand(text)) {
      case 'done':
        if (step && !row?.done_at) markDone()
        else setIdx(i => Math.min(i + 1, steps.length))
        return
      case 'back':   setIdx(i => Math.max(0, i - 1)); return
      case 'skip':   setIdx(i => Math.min(i + 1, steps.length)); return
      case 'repeat': player.current?.replay(); return
      case 'where':  voice.speak(`You're on step ${Math.min(idx + 1, steps.length)} of ${steps.length}, with ${doneCount} done.`); return
      default:       askInline(text)
    }
  }

  /** A spoken question → the job's chat (voice turn: short answer), read aloud as it arrives */
  async function askInline(question) {
    setAnswer({ question, text: '', busy: true })
    const spoken = createSentenceSplitter(sentence => voice.speak(sentence))
    const message = step ? `(On step ${idx + 1}: ${step.title}) ${question}` : question
    try {
      await sendToMechanic(
        chat?.id
          ? { conversationId: chat.id, message, voice: true }
          : { vehicleId: g.vehicle_id, guideRunId: runId, message, voice: true,
              entry: { kind: 'guide step', id: runId, label: `${g.title}${step ? `, step ${idx + 1}` : ''}` } },
        ev => {
          if (ev.type === 'text') {
            spoken.push(ev.delta)
            setAnswer(a => a && { ...a, text: a.text + ev.delta })
          } else if (ev.type === 'error') {
            setAnswer(a => a && { ...a, error: ev.error })
          }
        })
    } catch (err) {
      setAnswer(a => a && { ...a, error: err.message })
    } finally {
      spoken.flush()
      setAnswer(a => a && { ...a, busy: false })
      qc.invalidateQueries({ queryKey: ['ai_conversations', 'run', runId] })
    }
  }

  async function finish(outcome) {
    setBusy(true); setError(null)
    try {
      await finishRun(run, g, outcome, user?.id)
      invalidateGuides(qc, g.vehicle_id, g.id)
      await refresh()
      setFinished(outcome ?? 'abandoned')
      setFinishing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const unverifiedSpecs = savedSpecs.filter(s => !s.verification).length

  return (
    <div className="flex flex-col min-h-full">
      {/* Header + progress */}
      <div className="bg-primary-900 text-white px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button onClick={() => navigate(`/guides/${guideId}`)} className="flex items-center gap-1 text-primary-300 text-sm hover:text-white">
              <ArrowLeft size={14} /> Guide
            </button>
            {isActive && (
              <button type="button" onClick={toggleVoice} aria-pressed={voiceOn}
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg ${
                  voiceOn ? 'bg-amber-500 hover:bg-amber-400 text-white' : 'bg-primary-700 hover:bg-primary-600 text-white'}`}>
                {voiceOn ? <Volume2 size={13} /> : <VolumeX size={13} />} Voice
              </button>
            )}
          </div>
          <h1 className="text-lg font-bold leading-tight">{g.title}</h1>
          <p className="text-xs text-primary-100 mt-0.5">
            {g.vehicles?.name}{item ? ` · ${item.title}` : ''} · {doneCount} of {steps.length} steps done
            {!isActive && ` · ${run.status === 'abandoned' ? 'stopped' : 'finished'} ${run.finished_at ? format(parseISO(run.finished_at), 'MMM d') : ''}`}
          </p>
          <div className="h-1.5 bg-primary-800 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%` }} />
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-4 pb-10">
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        {/* Voice: hold to talk for commands or questions; spoken answers show here too */}
        {voiceOn && isActive && !finished && (
          <div className="card space-y-3">
            <GuidePlayer ref={player} guide={g} voice={voice} mode="job"
              stepIndex={idx} onStep={i => { setIdx(i); setNoteOpen(false) }} autoPlay={voiceOn} />
            <TalkButton voice={voice} onTranscript={onVoice} disabled={busy || answer?.busy}
              label="Hold to talk" />
            <p className="text-xs text-slate-500 text-center">Say “done”, “back”, “repeat”, “where am I”, or ask a question.</p>
            {voice.error && <p className="text-xs text-red-600">{voice.error}</p>}
            {answer && (
              <div className="border-t border-slate-100 pt-2 space-y-1 text-sm">
                <p className="text-xs text-slate-500">You asked: “{answer.question}”</p>
                {answer.busy && !answer.text && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 size={12} className="animate-spin" /> The mechanic is thinking…</p>
                )}
                {answer.text && <p className="text-slate-800 whitespace-pre-wrap">{answer.text}</p>}
                {answer.error && <p className="text-xs text-red-600">{answer.error}</p>}
                {!answer.busy && chat?.id && (
                  <Link to={`/mechanic/${chat.id}`} className="text-xs text-primary-700 underline">Open the job's chat</Link>
                )}
              </div>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-slate-500">Voice settings</summary>
              <div className="mt-2"><VoicePicker voice={voice} /></div>
            </details>
          </div>
        )}

        {/* Just finished on this phone: next actions */}
        {finished && (
          <div className="card space-y-3">
            <p className="flex items-center gap-2 font-semibold text-green-800"><CheckCircle2 size={18} />
              {finished === 'as_written' ? 'Done — guide marked "worked as written".'
                : finished === 'with_changes' ? 'Done — the guide needs updating.' : 'Job stopped.'}
            </p>
            {finished === 'as_written' && unverifiedSpecs > 0 && (
              <button type="button" className="btn-secondary w-full" disabled={busy}
                onClick={() => act(async () => {
                  await verifyGuideSpecs(g.id, user?.id)
                  qc.invalidateQueries({ queryKey: ['known_specs'] })
                })}>
                Mark this guide's {unverifiedSpecs} saved spec{unverifiedSpecs === 1 ? '' : 's'} "worked as written"
              </button>
            )}
            {finished === 'with_changes' && (
              <button type="button" className="btn-primary w-full"
                onClick={() => askMechanic(navigate, {
                  vehicleId: g.vehicle_id, conversationId: chat?.id, guideRunId: runId, intent: 'guide',
                  prompt: 'We finished this job with changes. Using my step notes, please propose an updated version of the guide.',
                  entry: { kind: 'guide', id: g.id, label: g.title },
                })}>
                Ask the mechanic to update the guide
              </button>
            )}
            {finished !== 'abandoned' && item && (
              <button type="button" className="btn-secondary w-full"
                onClick={() => navigate(`/vehicles/${item.vehicle_id}/add-visit`, { state: fromPendingState(item) })}>
                Log the service visit for "{item.title}"
              </button>
            )}
            <Link to={`/guides/${guideId}`} className="block text-center text-sm text-primary-700 underline">Back to the guide</Link>
          </div>
        )}

        {!isActive && !finished && (
          <p className="text-sm text-slate-600 bg-slate-100 rounded-lg px-3 py-2">
            This job is {run.status === 'abandoned' ? 'stopped' : `finished${run.outcome === 'as_written' ? ' (worked as written)' : ' (with changes)'}`}. Showing what was checked off.
          </p>
        )}

        {/* Before you start: open until the first step is done */}
        <details className="card" open={doneCount === 0 && idx === 0}>
          <summary className="cursor-pointer font-semibold text-sm text-slate-700">Before you start: tools, parts, safety</summary>
          <div className="mt-3"><BeforeYouStart body={g.body} /></div>
        </details>

        {/* Current step */}
        {step ? (
          <div className={`card space-y-4 ${row?.done_at ? 'border-green-300' : ''}`}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center justify-between">
              <span>Step {idx + 1} of {steps.length}</span>
              {row?.done_at && <span className="text-green-700 normal-case flex items-center gap-1"><Check size={13} /> done</span>}
            </p>
            <h2 className="text-xl font-bold text-slate-900 leading-snug">{step.title}</h2>
            <StepBody step={step} large />
            {row?.note && !noteOpen && (
              <p className="flex gap-2 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700">
                <StickyNote size={15} className="shrink-0 mt-0.5" />{row.note}
              </p>
            )}
            {noteOpen && (
              <div className="space-y-2">
                <textarea className="field-textarea" rows={3} autoFocus value={note} onChange={e => setNote(e.target.value)}
                  placeholder="e.g. drain plug was 15 mm, not 13 mm" />
                <div className="flex gap-2">
                  <button type="button" className="btn-primary text-sm" disabled={busy}
                    onClick={() => act(async () => { await setStepNote(runId, idx, note.trim()); setNoteOpen(false) })}>Save note</button>
                  <button type="button" className="btn-secondary text-sm" onClick={() => setNoteOpen(false)}>Cancel</button>
                </div>
              </div>
            )}

            {isActive && (
              row?.done_at
                ? <button type="button" disabled={busy} onClick={() => act(() => setStepDone(runId, idx, false, user?.id))}
                    className="w-full btn-secondary inline-flex items-center justify-center gap-1.5 py-3">
                    <Undo2 size={16} /> Not done yet
                  </button>
                : <button type="button" disabled={busy} onClick={markDone}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold text-lg rounded-xl py-4 inline-flex items-center justify-center gap-2">
                    <Check size={22} /> Done
                  </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={idx === 0} onClick={() => { setIdx(i => i - 1); setNoteOpen(false) }}
                className="btn-secondary inline-flex items-center justify-center gap-1 py-2.5 disabled:opacity-40">
                <ChevronLeft size={16} /> Back
              </button>
              <button type="button" onClick={() => { setIdx(i => Math.min(i + 1, steps.length)); setNoteOpen(false) }}
                className="btn-secondary inline-flex items-center justify-center gap-1 py-2.5">
                Next <ChevronRight size={16} />
              </button>
            </div>
            {isActive && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={openNote} className="btn-secondary inline-flex items-center justify-center gap-1.5 text-sm">
                  <StickyNote size={14} /> {row?.note ? 'Edit note' : 'Note'}
                </button>
                <button type="button" onClick={askAboutStep} className="btn-secondary inline-flex items-center justify-center gap-1.5 text-sm">
                  <MessagesSquare size={14} /> Ask about this step
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Past the last step: after-the-job checks and Finish */
          <div className="card space-y-3">
            <h2 className="text-lg font-bold text-slate-900">After the job</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">{(g.body?.after ?? []).map((s, i) => <li key={i}>{s}</li>)}</ul>
            {doneCount < steps.length && (
              <p className="text-sm text-amber-800">{steps.length - doneCount} step{steps.length - doneCount === 1 ? ' is' : 's are'} not checked off.</p>
            )}
            <button type="button" onClick={() => setIdx(steps.length - 1)} className="btn-secondary w-full">
              <ChevronLeft size={15} className="inline" /> Back to the last step
            </button>
            {isActive && !finishing && (
              <button type="button" onClick={() => setFinishing(true)}
                className="w-full bg-primary-700 hover:bg-primary-800 text-white font-bold rounded-xl py-3.5 inline-flex items-center justify-center gap-2">
                <Flag size={18} /> Finish job
              </button>
            )}
            {finishing && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">Did the guide work as written?</p>
                <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => finish('as_written')}>Yes, it worked as written</button>
                <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => finish('with_changes')}>Done, but the guide needs changes</button>
                <button type="button" className="w-full text-sm text-slate-500 underline py-1" disabled={busy}
                  onClick={() => { if (window.confirm('Stop this job without finishing? Progress is kept in the job history.')) finish(null) }}>
                  Stop without finishing
                </button>
                <button type="button" className="w-full text-sm text-slate-500 py-1" onClick={() => setFinishing(false)}>Cancel</button>
              </div>
            )}
          </div>
        )}

        {/* All steps */}
        <div className="card">
          <button type="button" onClick={() => setShowList(s => !s)}
            className="w-full flex items-center justify-between text-sm font-semibold text-slate-700">
            <span className="flex items-center gap-1.5"><ListChecks size={16} /> All steps</span>
            <span className="text-xs text-slate-500">{showList ? 'Hide' : 'Show'}</span>
          </button>
          {showList && (
            <ol className="mt-3 divide-y divide-slate-100">
              {steps.map((s, i) => {
                const r = rows.get(i)
                return (
                  <li key={i} className="flex items-center gap-2 py-2">
                    <button type="button" disabled={!isActive || busy} aria-label={r?.done_at ? 'Mark not done' : 'Mark done'}
                      onClick={() => act(() => setStepDone(runId, i, !r?.done_at, user?.id))}
                      className={`shrink-0 w-6 h-6 rounded-md border flex items-center justify-center
                                  ${r?.done_at ? 'bg-green-600 border-green-600 text-white' : 'border-slate-300 bg-white'}`}>
                      {r?.done_at && <Check size={14} />}
                    </button>
                    <button type="button" onClick={() => { setIdx(i); setShowList(false); window.scrollTo({ top: 0 }) }}
                      className={`flex-1 text-left text-sm ${i === idx ? 'font-semibold text-primary-800' : 'text-slate-700'}`}>
                      {i + 1}. {s.title}
                      {r?.note && <StickyNote size={12} className="inline ml-1 text-slate-400" />}
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
