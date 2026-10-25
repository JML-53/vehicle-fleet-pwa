/**
 * Voice (item 29, phase 1b): hold to talk, transcribe, and speak answers
 * sentence by sentence. Shared by the mechanic chat and guide check-off mode.
 *
 * Listening goes phone → `voice` Edge Function → OpenAI gpt-transcribe;
 * speaking goes phone → `voice` → Google Chirp 3 HD. The keys never reach the
 * phone. Answers stream from the mechanic, so each finished sentence is sent
 * to `speak` while the next is still being written, and audio plays in order:
 * you hear the first sentence long before the answer is complete.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useStoredState } from '@/lib/useStoredState'

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice`
export const DEFAULT_VOICE = 'en-US-Chirp3-HD-Charon'

/** English accents the family can pick. Google offers the first four; IE and NZ show when it adds them. */
export const VOICE_COUNTRIES = {
  'en-US': 'United States',
  'en-GB': 'United Kingdom',
  'en-AU': 'Australia',
  'en-IN': 'India',
  'en-IE': 'Ireland',
  'en-NZ': 'New Zealand',
}
const COUNTRY_SHORT = { 'en-US': 'US', 'en-GB': 'UK', 'en-AU': 'AU', 'en-IN': 'IN', 'en-IE': 'IE', 'en-NZ': 'NZ' }
/** "en-GB-Chirp3-HD-Charon" → "Charon · UK" */
export const voiceLabel = name => `${name.split('-').pop()} · ${COUNTRY_SHORT[name.slice(0, 5)] ?? name.slice(0, 5)}`

async function callVoice(body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${session.access_token}`,
      apikey:         import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Voice unavailable (HTTP ${res.status})`)
  return res
}

async function callVoiceJson(body) {
  const j = await (await callVoice(body)).json()
  if (!j.success) throw new Error(j.error || 'Voice failed')
  return j
}

// ── Listening ────────────────────────────────────────────────────────────────

/** Starts the microphone; returns { stop } → Promise<{ blob, mime, duration }> */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t))
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks = []
  const startedAt = Date.now()
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  const done = new Promise(resolve => {
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      resolve({ blob: new Blob(chunks, { type: rec.mimeType }), mime: rec.mimeType, duration: (Date.now() - startedAt) / 1000 })
    }
  })
  rec.start()
  return { stop: () => { if (rec.state === 'recording') rec.stop(); return done } }
}

/** A clip → what was said, or "" when nothing usable was heard */
export async function transcribeClip({ blob, mime, duration }) {
  if (duration < 0.4 || blob.size < 1000) return ''   // a tap, not speech
  const audio = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error("Couldn't read the recording"))
    r.readAsDataURL(blob)
  })
  return (await callVoiceJson({ action: 'transcribe', audio, mime, duration })).text
}

// ── Speaking ─────────────────────────────────────────────────────────────────

// One <audio> element for the whole app. Phones only play sound after a tap;
// starting this element from a tap (unlockAudio) lets it keep playing later.
let player = null
function getPlayer() {
  if (!player) player = new Audio()
  return player
}

/** A tenth of a second of silence (WAV), used to unlock audio on the first tap */
function silentWavUrl() {
  const samples = 800, buf = new ArrayBuffer(44 + samples), v = new DataView(buf)
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, 36 + samples, true); str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  str(36, 'data'); v.setUint32(40, samples, true)
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128)
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

let unlocked = false
/** Call from a tap (hold-to-talk, the Voice toggle) before anything is spoken */
export function unlockAudio() {
  if (unlocked) return
  unlocked = true
  const p = getPlayer()
  p.src = silentWavUrl()
  p.play().catch(() => { unlocked = false })
}

async function fetchSpeech(text, voice, rate) {
  const res = await callVoice({ action: 'speak', text, voice, rate })
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    throw new Error((await res.json()).error || 'Speaking failed')
  }
  return URL.createObjectURL(await res.blob())
}

/**
 * A queue of sentences to say. Each sentence's audio is requested as soon as
 * it's queued (so the next one is ready when the current one ends) and they
 * play in order.
 *   speak(text)  queue one piece as is
 *   say(text)    split into sentences and queue them; resolves 'done' when the
 *                last one has played, or 'cancelled' if stop() came first
 *   pause() / resume()  hold and continue mid-sentence
 *   stop()       empty the queue and cut the current sentence
 * The audio element fires "pause" both when you pause and when a clip ends, so
 * a user pause is flagged and doesn't count as "this sentence is finished".
 */
export function createSpeaker({ getVoice, getRate, onState, onError }) {
  let queue = []
  let current = null                        // the item playing now
  let playing = false
  let userPaused = false
  let clipActive = false                    // a clip is mid-play (resume continues it; otherwise it would restart)
  let resumeWaiters = []
  let generation = 0                        // stop() bumps it so late audio is dropped
  const untilResumed = () => new Promise(r => resumeWaiters.push(r))
  const releaseWaiters = () => { resumeWaiters.forEach(r => r()); resumeWaiters = [] }

  function playUrl(url) {
    return new Promise((resolve, reject) => {
      const p = getPlayer()
      const finish = () => { clipActive = false; resolve() }
      p.onpause = null
      p.onended = null
      p.onerror = () => { clipActive = false; reject(new Error("Couldn't play the answer")) }
      p.src = url
      // Listen for the end only once this clip is playing: swapping src can fire a
      // stray "pause" from the previous clip. A pause from stop() also ends it.
      p.play()
        .then(() => {
          clipActive = true
          p.onpause = () => { if (!userPaused) finish() }
          p.onended = finish
        })
        .catch(err => { clipActive = false; reject(err) })
    })
  }

  async function playNext(gen) {
    const item = queue.shift()
    if (!item || gen !== generation) { playing = false; current = null; onState?.('idle'); return }
    playing = true
    current = item
    if (!userPaused) onState?.('speaking')
    let outcome = 'done'
    try {
      const url = await item.audio
      if (userPaused && gen === generation) await untilResumed()   // paused between sentences: wait
      if (gen === generation) await playUrl(url)
      URL.revokeObjectURL(url)
    } catch (err) {
      outcome = 'error'
      onError?.(err)
    }
    item.onDone?.(gen === generation ? outcome : 'cancelled')
    playNext(gen)
  }

  function enqueue(text, onDone) {
    const clean = speechText(text)
    if (!clean) return false
    const item = { audio: fetchSpeech(clean, getVoice(), getRate()), onDone }
    item.audio.catch(() => {})              // reported when it's its turn to play
    queue.push(item)
    if (!playing) playNext(generation)
    return true
  }

  return {
    speak(text) { enqueue(text) },
    say(text) {
      return new Promise(resolve => {
        const parts = []
        const s = createSentenceSplitter(sentence => parts.push(sentence))
        s.push(text)
        s.flush()
        const queued = parts.filter((p, i) => enqueue(p, i === parts.length - 1 ? resolve : undefined))
        if (!queued.length) resolve('done')
      })
    },
    pause() {
      if (!playing || userPaused) return
      userPaused = true
      if (clipActive) player.pause()
      onState?.('paused')
    },
    resume() {
      if (!userPaused) return
      userPaused = false
      if (clipActive) player.play().catch(err => onError?.(err))
      releaseWaiters()
      onState?.('speaking')
    },
    stop() {
      userPaused = false
      releaseWaiters()
      generation++
      const dropped = queue
      queue = []
      dropped.forEach(item => item.onDone?.('cancelled'))
      if (clipActive && !player.paused) player.pause()
      else current?.onDone?.('cancelled')   // paused or still fetching: playNext won't report it
      clipActive = false
      current = null
      playing = false
      onState?.('idle')
    },
  }
}

/** Markdown and shop shorthand → words that sound right read aloud */
export function speechText(s = '') {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')                 // table rows
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')         // [text](url) → text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*(#{1,6}|[-*•]|\d+[.)])\s+/gm, '')  // headings, list markers
    .replace(/[*_`>#]/g, '')
    .replace(/\bft[.\s-]*lbs?\b/gi, 'foot-pounds')
    .replace(/(\d)\s*mm\b/gi, '$1 millimeter')
    .replace(/(\d)\s*qts?\b/gi, '$1 quarts')
    .replace(/(\d)\s*°\s*F\b/g, '$1 degrees')
    .replace(/~\s*/g, 'about ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Sentences from a streamed answer ─────────────────────────────────────────

const ABBREVIATIONS = /\b(e\.g|i\.e|etc|approx|vs|no|dr|st|ft|lb|lbs|qt|min|max|in|fig)\.$/i

/** Index just past the first sentence end in buf (or -1): [.!?] then a space, or a line break */
function sentenceEnd(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    const c = buf[i], next = buf[i + 1]
    const end = c === '\n' || ('.!?'.includes(c) && /\s/.test(next) && !ABBREVIATIONS.test(buf.slice(0, i + 1)))
    if (end && speechText(buf.slice(0, i + 1)).length >= 12) return i + 1   // skip tiny fragments ("1." etc.)
  }
  return -1
}

/** Feed it text deltas; it calls onSentence with each complete sentence. flush() at the end. */
export function createSentenceSplitter(onSentence) {
  let buf = ''
  return {
    push(delta) {
      buf += delta
      let n
      while ((n = sentenceEnd(buf)) >= 0) {
        onSentence(buf.slice(0, n))
        buf = buf.slice(n)
      }
    },
    flush() {
      if (speechText(buf)) onSentence(buf)
      buf = ''
    },
  }
}

/** Say a whole answer (read-aloud button); resolves 'done' or 'cancelled' */
export function speakAll(speaker, text) {
  return speaker.say(text)
}

// ── Commands in check-off mode (matched on the phone: instant and free) ──────

export function matchCommand(text) {
  const t = text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^(ok(ay)? )?(done|next|next step|check|checked|finished|got it|step done)( please)?$/.test(t)) return 'done'
  if (/^(go back|back|previous|previous step|last step)( please)?$/.test(t)) return 'back'
  if (/^(repeat|repeat that|say again|say that again|again|come again|what was that)( please)?$/.test(t)) return 'repeat'
  if (/^(where am i|progress|what step am i on|how many left)$/.test(t)) return 'where'
  if (/^(skip|skip it|skip this|skip that|skip step)$/.test(t)) return 'skip'
  return null
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useVoiceSettings() {
  const [voice, setVoice] = useStoredState('voice_name', DEFAULT_VOICE)
  const [rate, setRate]   = useStoredState('voice_rate', 1)
  return { voice, setVoice, rate, setRate }
}

/** The en-US Chirp 3 HD voices Google offers today */
export function useVoiceList(enabled) {
  return useQuery({
    queryKey: ['voice_list'],
    queryFn: async () => (await callVoiceJson({ action: 'voices' })).voices,
    enabled,
    retry: false,
  })
}

/**
 * Hold-to-talk + speaking for one screen.
 *   state: idle | listening | transcribing | speaking | paused
 *   startListening() on press, stopListening() on release → transcript ("" = nothing heard)
 */
export function useVoice() {
  const settings = useVoiceSettings()
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [state, setState] = useState('idle')
  const [error, setError] = useState(null)
  const starting = useRef(null)

  const speaker = useMemo(() => createSpeaker({
    getVoice: () => settingsRef.current.voice,
    getRate:  () => settingsRef.current.rate,
    onState:  s => setState(cur => (cur === 'listening' || cur === 'transcribing' ? cur : s)),
    onError:  err => setError(err.message),
  }), [])
  useEffect(() => () => speaker.stop(), [speaker])

  function startListening() {
    setError(null)
    unlockAudio()
    speaker.stop()                           // talking over the mechanic stops it
    setState('listening')
    starting.current = startRecording().catch(err => {
      setError(err.name === 'NotAllowedError' ? 'Allow the microphone for this site, then try again.' : err.message)
      setState('idle')
      return null
    })
  }

  async function stopListening() {
    const rec = await starting.current      // released before the mic was ready: wait for it
    starting.current = null
    if (!rec) return ''
    const clip = await rec.stop()
    setState('transcribing')
    try {
      return await transcribeClip(clip)
    } catch (err) {
      setError(err.message)
      return ''
    } finally {
      setState('idle')
    }
  }

  return {
    state, error, setError, settings, speaker,
    startListening, stopListening,
    speak: text => speaker.speak(text),
    say: text => speaker.say(text),          // → 'done' | 'cancelled'
    pause: () => speaker.pause(),
    resume: () => speaker.resume(),
    stopSpeaking: () => speaker.stop(),
  }
}
