/**
 * GuidePlayer — read a guide aloud with play / pause / skip and a section
 * picker (item 29, phase 1b).
 *
 *   mode 'listen' (guide page): plays straight through to the end.
 *   mode 'job' (check-off mode): follows the step you're on (stepIndex) and
 *     reads it on arrival when autoPlay is on; stops after a step (do the work,
 *     then say "done"), and after the last piece of any other section.
 *     Skipping onto a step moves the checklist there too (onStep).
 *
 * Skipping moves one piece: a step, a tool, a tip. In job mode it reads the
 * new piece (and moves the checklist when it lands on a step), since the
 * player sits idle between steps; on the guide page it only plays if already
 * playing. Picking "Steps" in job mode goes to the step you're on. Pausing
 * holds mid-sentence; play continues from there. Parent pages reach replay()
 * through the ref (the "repeat" voice command).
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Loader2 } from 'lucide-react'
import { unlockAudio } from '@/lib/voice'
import { guideSegments, GUIDE_SECTIONS, SECTION_LABEL } from '@/lib/guides'

const GuidePlayer = forwardRef(function GuidePlayer({ guide, voice, mode = 'listen', stepIndex, onStep, autoPlay = false }, ref) {
  const segments = useMemo(() => guideSegments(guide), [guide])
  const [pos, setPos] = useState(0)
  const [status, setStatus] = useState('idle')       // idle | playing | paused
  const token = useRef(0)                            // each new playFrom() cancels the old chain

  const sections = GUIDE_SECTIONS.filter(([key]) => segments.some(s => s.section === key))
  const seg = segments[pos]
  const inSection = segments.filter(s => s.section === seg?.section)
  const nInSection = inSection.indexOf(seg) + 1

  function nextAuto(i) {
    const s = segments[i], n = segments[i + 1]
    if (!n) return null
    if (mode === 'listen') return i + 1
    if (s.section === 'steps') return null           // job mode: wait for "done"
    return n.section === s.section ? i + 1 : null    // finish the section, then stop
  }

  async function playFrom(i) {
    const t = ++token.current
    unlockAudio()
    voice.stopSpeaking()
    setPos(i)
    setStatus('playing')
    const s = segments[i]
    if (mode === 'job' && s.step !== undefined && s.step !== stepIndex) onStep?.(s.step)
    const result = await voice.say(s.text)
    if (t !== token.current) return                  // something newer took over
    const next = result === 'done' ? nextAuto(i) : null
    if (next !== null) playFrom(next)
    else setStatus('idle')
  }

  function toggle() {
    if (status === 'playing') { voice.pause(); setStatus('paused') }
    else if (status === 'paused') { voice.resume(); setStatus('playing') }
    else playFrom(pos)
  }

  function skip(by) {
    const i = Math.min(segments.length - 1, Math.max(0, pos + by))
    if (status === 'idle' && !autoPlay) { setPos(i); return }   // guide page, not playing: just move
    playFrom(i)
  }

  function jumpTo(section) {
    const current = mode === 'job' && section === 'steps' ? segments.findIndex(s => s.step === stepIndex) : -1
    const i = current >= 0 ? current : segments.findIndex(s => s.section === section)
    if (i >= 0) playFrom(i)
  }

  // Job mode: follow the checklist (Done / Back / Next / voice), reading on arrival
  useEffect(() => {
    if (mode !== 'job' || stepIndex == null || !segments.length) return
    const i = stepIndex < (guide?.body?.steps?.length ?? 0)
      ? segments.findIndex(s => s.step === stepIndex)
      : segments.findIndex(s => s.section === 'after')
    if (i < 0 || (i === pos && status !== 'idle')) return   // we moved it ourselves and are already reading it
    if (autoPlay) playFrom(i)
    else setPos(i)
  }, [stepIndex, autoPlay]) // eslint-disable-line react-hooks/exhaustive-deps

  // Something else stopped the speech (hold to talk, leaving the page): show idle
  useEffect(() => {
    if (voice.state === 'idle' && status === 'paused') setStatus('idle')
  }, [voice.state]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({ replay: () => playFrom(pos) }))

  if (!segments.length) return null
  const busy = status === 'playing' && voice.state !== 'speaking'   // fetching the first sentence

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <select value={seg?.section} onChange={e => jumpTo(e.target.value)} aria-label="Section"
          className="field-select w-auto text-sm py-1.5">
          {sections.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <span className="text-xs text-slate-500">{SECTION_LABEL[seg?.section]} · {nInSection} of {inSection.length}</span>
      </div>
      <p className="text-sm text-slate-700 line-clamp-2 min-h-[2.5rem]">{seg?.text}</p>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={() => skip(-1)} disabled={pos === 0} aria-label="Back one"
          className="btn-secondary py-3 inline-flex items-center justify-center disabled:opacity-40"><SkipBack size={20} /></button>
        <button type="button" onClick={toggle} aria-label={status === 'playing' ? 'Pause' : 'Play'}
          className="rounded-lg py-3 inline-flex items-center justify-center bg-amber-500 hover:bg-amber-400 text-white">
          {busy ? <Loader2 size={22} className="animate-spin" /> : status === 'playing' ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button type="button" onClick={() => skip(1)} disabled={pos === segments.length - 1} aria-label="Forward one"
          className="btn-secondary py-3 inline-flex items-center justify-center disabled:opacity-40"><SkipForward size={20} /></button>
      </div>
    </div>
  )
})

export default GuidePlayer
