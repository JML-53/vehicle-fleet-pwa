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

function playUrl(url) {
  return new Promise((resolve, reject) => {
    const p = getPlayer()
    p.onpause = null
    p.onended = null
    p.onerror = () => reject(new Error("Couldn't play the answer"))
    p.src = url
    // Listen for the end only once this clip is playing: swapping src can fire a
    // stray "pause" from the previous clip. "pause" also covers stop().
    p.play()
      .then(() => { p.onpause = () => resolve(); p.onended = () => resolve() })
      .catch(reject)
  })
}

/**
 * A queue of sentences to say. Each sentence's audio is requested as soon as
 * it's queued (so the next one is ready when the current one ends) and they
 * play in order. stop() empties the queue and cuts the current sentence.
 */
export function createSpeaker({ getVoice, getRate, onState, onError }) {
  const queue = []
  let playing = false
  let generation = 0                        // stop() bumps it so late audio is dropped
  async function playNext(gen) {
    const item = queue.shift()
    if (!item || gen !== generation) { playing = false; onState?.('idle'); return }
    playing = true
    onState?.('speaking')
    try {
      const url = await item.audio
      if (gen === generation) await playUrl(url)
      URL.revokeObjectURL(url)
    } catch (err) {
      onError?.(err)
    }
    playNext(gen)
  }
  return {
    speak(text) {
      const clean = speechText(text)
      if (!clean) return
      const item = { audio: fetchSpeech(clean, getVoice(), getRate()) }
      item.audio.catch(() => {})            // reported when it's its turn to play
      queue.push(item)
      if (!playing) playNext(generation)
    },
    stop() {
      generation++
      queue.length = 0
      if (player && !player.paused) player.pause()
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

/** Say a whole answer (read-aloud button) */
export function speakAll(speaker, text) {
  const s = createSentenceSplitter(sentence => speaker.speak(sentence))
  s.push(text)
  s.flush()
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
 *   state: idle | listening | transcribing | speaking
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
    stopSpeaking: () => speaker.stop(),
  }
}
