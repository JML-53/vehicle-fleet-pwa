/**
 * VoiceTestPage — garage noise test for speech-to-text (item 29, phase 1b,
 * plan build step 4). Route: /admin/voice-test (admin only)
 *
 * Pick the noise condition, tap Record, read the phrase, tap Stop. The
 * recording is saved, the `voice` Edge Function runs it through each
 * candidate transcriber in parallel, and the results are scored here
 * (src/lib/voiceTest.js): word accuracy after normalizing numbers and units,
 * key terms heard, and time. The scoreboard compares candidates overall,
 * quiet and noisy. Recordings stay until "Delete all test recordings", so
 * another service can be tried on the same audio.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Mic, Square, Loader2, Trash2, Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  PHRASES, CONDITIONS, CANDIDATE_LABEL, useVoiceTests, scoreTest, summarize,
} from '@/lib/voiceTest'

const MAX_SECONDS = 15
const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`)

/** Tap-to-start / tap-to-stop recorder (MediaRecorder: Opus/WebM on Android, MP4 on iPhone) */
function useRecorder() {
  const rec = useRef(null)
  const [recording, setRecording] = useState(null)   // phrase index being recorded
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (recording === null) return
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [recording])

  async function start(phraseNo, onDone) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t))
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks = []
    const startedAt = Date.now()
    r.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    r.onstop = () => {
      stream.getTracks().forEach(tr => tr.stop())
      setRecording(null)
      onDone({ blob: new Blob(chunks, { type: r.mimeType }), mime: r.mimeType, duration: (Date.now() - startedAt) / 1000 })
    }
    r.start()
    rec.current = r
    setSeconds(0)
    setRecording(phraseNo)
  }

  function stop() { if (rec.current?.state === 'recording') rec.current.stop() }

  useEffect(() => { if (recording !== null && seconds >= MAX_SECONDS) stop() }, [seconds, recording])
  useEffect(() => () => stop(), [])
  return { recording, seconds, start, stop }
}

export default function VoiceTestPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: tests = [], isLoading } = useVoiceTests()
  const { recording, seconds, start, stop } = useRecorder()
  const [condition, setCondition] = useState('quiet')
  const [busy, setBusy] = useState(null)      // phrase index being uploaded / transcribed
  const [error, setError] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function record(phraseNo) {
    setError(null)
    try {
      await start(phraseNo, clip => save(phraseNo, clip))
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? 'Allow the microphone for this site, then try again.' : err.message)
    }
  }

  async function save(phraseNo, { blob, mime, duration }) {
    setBusy(phraseNo)
    try {
      const base = mime.split(';')[0]
      const path = `voice-test/${crypto.randomUUID()}.${base === 'audio/mp4' ? 'mp4' : 'webm'}`
      const up = await supabase.storage.from('documents').upload(path, blob, { contentType: base })
      if (up.error) throw up.error
      const { data: row, error: e1 } = await supabase.from('voice_tests').insert({
        phrase_no: phraseNo, expected: PHRASES[phraseNo].text, condition,
        audio_path: path, media_type: mime, duration_s: Math.round(duration * 100) / 100,
      }).select('id').single()
      if (e1) throw e1
      const { data, error: e2 } = await supabase.functions.invoke('voice', { body: { action: 'transcribe_test', testId: row.id } })
      if (e2) throw e2
      if (!data?.success) throw new Error(data?.error || 'Transcription failed')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
      qc.invalidateQueries({ queryKey: ['voice_tests'] })
    }
  }

  async function deleteAll() {
    if (!window.confirm(`Delete all ${tests.length} test recordings and their results?`)) return
    setDeleting(true); setError(null)
    try {
      const paths = tests.map(t => t.audio_path)
      if (paths.length) await supabase.storage.from('documents').remove(paths)
      const { error } = await supabase.from('voice_tests').delete().in('id', tests.map(t => t.id))
      if (error) throw error
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
      qc.invalidateQueries({ queryKey: ['voice_tests'] })
    }
  }

  const summary = summarize(tests)

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
            <ArrowLeft size={14} /> Back
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2"><Mic size={18} /> Voice noise test</h1>
          <p className="text-primary-100 text-sm mt-1">
            Read each phrase in the garage: once somewhere quiet, then with the noise you'll really have.
            Hold the phone where you would while working.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3" role="group" aria-label="Noise">
            {Object.entries(CONDITIONS).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setCondition(k)} disabled={recording !== null}
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  condition === k ? 'bg-white text-primary-900' : 'bg-primary-800 text-primary-100'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 max-w-2xl mx-auto space-y-4 pb-10">
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        {summary.length > 0 && (
          <div className="card">
            <h2 className="card-header">Scoreboard · {tests.length} recording{tests.length === 1 ? '' : 's'}</h2>
            <div className="overflow-x-auto -mx-4">
              <table className="data-table min-w-full text-xs">
                <thead>
                  <tr><th>Transcriber</th><th>Words</th><th>Quiet</th><th>Noisy</th><th>Key terms</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {summary.map(s => (
                    <tr key={s.key}>
                      <td className="font-medium text-slate-800">{CANDIDATE_LABEL[s.key] ?? s.key}{s.errors ? ` · ${s.errors} failed` : ''}</td>
                      <td className="font-semibold">{pct(s.accuracy)}</td>
                      <td>{pct(s.quiet)}</td>
                      <td>{pct(s.noisy)}</td>
                      <td className="font-semibold">{pct(s.keyRate)}</td>
                      <td>{s.ms ? `${(s.ms / 1000).toFixed(1)} s` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Words = share of words right after writing numbers and units the same way. Key terms = the words that
              matter on the job (torque values, names, IAC/TPS). Time includes the trip to OpenAI.
            </p>
          </div>
        )}

        {isLoading && <p className="text-sm text-slate-400 animate-pulse">Loading…</p>}

        {PHRASES.map((p, i) => {
          const mine = tests.filter(t => t.phrase_no === i)
          const isRec = recording === i
          return (
            <div key={i} className="card space-y-3">
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-primary-50 text-primary-800 text-sm font-bold flex items-center justify-center">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-slate-900">“{p.text}”</p>
                  <p className="text-xs text-slate-500 mt-0.5">Key terms: {p.keys.join(' · ')}</p>
                </div>
              </div>
              {isRec ? (
                <button type="button" onClick={stop}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl py-3 inline-flex items-center justify-center gap-2">
                  <Square size={16} /> Stop · {seconds}s
                </button>
              ) : busy === i ? (
                <p className="flex items-center justify-center gap-2 text-sm text-slate-500 py-3">
                  <Loader2 size={16} className="animate-spin" /> Transcribing…
                </p>
              ) : (
                <button type="button" onClick={() => record(i)} disabled={recording !== null || busy !== null}
                  className="w-full btn-primary py-3 inline-flex items-center justify-center gap-2 disabled:opacity-40">
                  <Mic size={16} /> Record · {CONDITIONS[condition]}
                </button>
              )}
              {mine.map(t => <TestResult key={t.id} test={t} />)}
            </div>
          )
        })}

        {tests.length > 0 && (
          <div className="flex justify-end">
            <button type="button" onClick={deleteAll} disabled={deleting}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 text-red-700">
              <Trash2 size={14} /> Delete all test recordings
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TestResult({ test }) {
  const scored = scoreTest(test)
  return (
    <div className="border-t border-slate-100 pt-2 space-y-1.5">
      <p className="text-xs text-slate-500">
        <span className="badge-slate">{CONDITIONS[test.condition] ?? test.condition}</span>{' '}
        {Number(test.duration_s).toFixed(1)} s recording
        {!scored.length && ' · not transcribed'}
      </p>
      {scored.map(r => (
        <div key={r.key} className="text-xs">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-slate-700">{CANDIDATE_LABEL[r.key] ?? r.key}</span>
            <span className={r.accuracy >= 0.9 ? 'text-green-700' : r.accuracy >= 0.7 ? 'text-amber-700' : 'text-red-700'}>{pct(r.accuracy)}</span>
            <span className="text-slate-400">{(r.ms / 1000).toFixed(1)} s</span>
          </p>
          {r.error
            ? <p className="text-red-600">{r.error}</p>
            : <p className="text-slate-700">“{r.text}”</p>}
          <p className="flex flex-wrap gap-1 mt-0.5">
            {r.hits.map(h => (
              <span key={h.term} className={`inline-flex items-center gap-0.5 ${h.hit ? 'text-green-700' : 'text-red-700'}`}>
                {h.hit ? <Check size={10} /> : <X size={10} />}{h.term}
              </span>
            ))}
          </p>
        </div>
      ))}
    </div>
  )
}
