/**
 * voice — Supabase Edge Function (roadmap item 29, phase 1b)
 *
 * Speech for the mechanic. Listening: OpenAI gpt-transcribe with a vocabulary
 * hint and English (chosen by the garage noise test, 10/25). Speaking: Google
 * Cloud Text-to-Speech, Chirp 3 HD voices (OpenAI's TTS shuts down Jan 2027).
 * The keys (OPENAI_API_KEY, GOOGLE_TTS_API_KEY) stay here; the phone only ever
 * talks to this function.
 *
 * Request body: { action, ... }
 *   transcribe { audio, mime, duration }  a short clip (base64) → { text }; text is ""
 *                                when nothing usable was heard (never act on it)
 *   speak { text, voice?, rate? }  one sentence → MP3 bytes (audio/mpeg)
 *   voices                       → { voices: [{ name, locale, label, gender }] } Chirp 3 HD
 *                                in en-US / en-GB / en-AU / en-IN (en-IE, en-NZ when Google adds them)
 *   transcribe_test { testId, only? }  admin: run one recorded test phrase (voice_tests
 *                                row + its audio in Storage) through each candidate
 *                                transcriber in parallel; saves the results on the
 *                                row and logs the cost in ai_usage. `only` = run just
 *                                these candidate keys and merge them into the row
 *                                (to try a new setting on recordings already made).
 *
 * Response: JSON { success: true, … } | { success: false, error }, except a
 * successful `speak`, which returns the audio itself.
 * Costs go to ai_usage (voice_listen, voice_speak) and count toward the cap.
 */
// deno-lint-ignore-file no-explicit-any

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { requireUser, AuthError } from "../_shared/auth.ts"

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions"

// gpt-transcribe is OpenAI's recommended model; gpt-4o-transcribe is deprecated
// (shutdown Feb 2027) and is here only as a yardstick.
const CANDIDATES = [
  { key: "gpt-transcribe+vocab", model: "gpt-transcribe",    vocab: true  },
  { key: "gpt-transcribe",       model: "gpt-transcribe",    vocab: false },
  { key: "gpt-4o-transcribe+vocab", model: "gpt-4o-transcribe", vocab: true  },
  // After the first garage test: short commands in noise were misheard as Spanish
  // ("Repita") or nothing; this one says the speech is English and names the commands.
  { key: "gpt-transcribe+vocab2+en", model: "gpt-transcribe", vocab: true, vocab2: true, english: true, extra: true },
]
const PER_MINUTE_USD: Record<string, number> = {
  "gpt-transcribe": 0.0045, "gpt-4o-transcribe": 0.006, "gpt-4o-mini-transcribe": 0.003,
}
const EXTENSION: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a" }

const LISTEN_MODEL      = "gpt-transcribe"
const MAX_CLIP_BYTES    = 5 * 1024 * 1024     // ~5 minutes of Opus; push-to-talk clips are seconds
const GOOGLE_TTS        = "https://texttospeech.googleapis.com/v1"
const DEFAULT_VOICE     = "en-US-Chirp3-HD-Charon"
const LOCALES           = ["en-US", "en-GB", "en-AU", "en-IN", "en-IE", "en-NZ"]   // the English accents the family can pick
const MAX_SPEAK_CHARS   = 1500
const SPEAK_USD_PER_CHAR = 30 / 1_000_000      // list price; Google's first 1M characters a month are free

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS })
  }

  try {
    const { profile, service } = await requireUser(req)
    const body = await req.json()

    // ── Speaking (Google) ───────────────────────────────────────────────────
    if (body.action === "speak" || body.action === "voices") {
      const googleKey = Deno.env.get("GOOGLE_TTS_API_KEY")
      if (!googleKey) return fail("Speaking isn't set up yet (GOOGLE_TTS_API_KEY).")

      if (body.action === "voices") {
        const res = await fetch(`${GOOGLE_TTS}/voices`, { headers: { "X-Goog-Api-Key": googleKey } })
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok) return fail(`Google: ${data?.error?.message ?? res.status}`)
        // Chirp 3 HD voices in the family's English locales. Google offers en-US, en-GB,
        // en-AU and en-IN (10/25); en-IE and en-NZ have no voices yet but are asked for,
        // so they appear if Google adds them.
        const voices = (data.voices ?? [])
          .filter((v: any) => LOCALES.includes(v.languageCodes?.[0]) && v.name.includes("-Chirp3-HD-"))
          .map((v: any) => ({ name: v.name, locale: v.languageCodes[0], label: v.name.split("-").pop(), gender: v.ssmlGender }))
          .sort((a: any, b: any) => a.locale.localeCompare(b.locale) || a.label.localeCompare(b.label))
        return json({ success: true, voices })
      }

      const text = String(body.text ?? "").trim().slice(0, MAX_SPEAK_CHARS)
      if (!text) return fail("Nothing to say")
      const ok = /^en-[A-Z]{2}-Chirp3-HD-[A-Za-z]+$/.test(body.voice ?? "") && LOCALES.includes(body.voice.slice(0, 5))
      const voice = ok ? body.voice : DEFAULT_VOICE
      const rate  = Math.min(1.5, Math.max(0.75, Number(body.rate) || 1))
      const res = await fetch(`${GOOGLE_TTS}/text:synthesize`, {
        method: "POST",
        headers: { "X-Goog-Api-Key": googleKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: voice.slice(0, 5), name: voice },   // e.g. en-GB from en-GB-Chirp3-HD-Charon
          audioConfig: { audioEncoding: "MP3", speakingRate: rate },
        }),
      })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok || !data.audioContent) return fail(`Google: ${data?.error?.message ?? res.status}`)
      await logUsage(service, profile.id, "voice_speak", "chirp3-hd", text.length * SPEAK_USD_PER_CHAR)
      return new Response(fromBase64(data.audioContent), {
        headers: { ...CORS, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
      })
    }

    // ── Listening (OpenAI) ──────────────────────────────────────────────────
    const apiKey = Deno.env.get("OPENAI_API_KEY")
    if (!apiKey) return fail("The OpenAI key isn't set up (OPENAI_API_KEY).")

    if (body.action === "transcribe") {
      const mime = String(body.mime ?? "audio/webm").split(";")[0]
      const bytes = fromBase64(String(body.audio ?? ""))
      if (!bytes.length) return fail("No audio")
      if (bytes.length > MAX_CLIP_BYTES) return fail("That clip is too long")
      const audio = new Blob([bytes], { type: mime })
      const raw = await transcribe(apiKey, audio, `clip.${EXTENSION[mime] ?? "webm"}`, LISTEN_MODEL, await listeningHint(service), true)
      const duration = Math.min(600, Math.max(0, Number(body.duration) || 0))
      await logUsage(service, profile.id, "voice_listen", LISTEN_MODEL, (duration / 60) * PER_MINUTE_USD[LISTEN_MODEL])
      // A cough or a clank comes back as "" or "." — report nothing heard rather than a command
      const text = /[a-z0-9]{2,}/i.test(raw) ? raw : ""
      return json({ success: true, text })
    }

    if (body.action === "transcribe_test") {
      if (profile.role !== "admin") return fail("Admin only")
      const { data: test, error } = await service.from("voice_tests").select("*").eq("id", body.testId).single()
      if (error || !test) return fail("Test recording not found")

      const { data: blob, error: dlErr } = await service.storage.from("documents").download(test.audio_path)
      if (dlErr || !blob) return fail(`Couldn't load the recording: ${dlErr?.message}`)
      const mime = (test.media_type ?? "audio/webm").split(";")[0]
      const filename = `test.${EXTENSION[mime] ?? "webm"}`
      const vocab = await vocabulary(service)
      const vocab2 = await listeningHint(service)
      const run = Array.isArray(body.only)
        ? CANDIDATES.filter(c => body.only.includes(c.key))
        : CANDIDATES.filter(c => !c.extra)

      const fresh = await Promise.all(run.map(async (c: any) => {
        const started = Date.now()
        try {
          const text = await transcribe(apiKey, blob, filename, c.model, c.vocab2 ? vocab2 : c.vocab ? vocab : "", c.english)
          return { key: c.key, model: c.model, prompt: c.vocab, text, ms: Date.now() - started,
                   cost_usd: round4((Number(test.duration_s ?? 0) / 60) * (PER_MINUTE_USD[c.model] ?? 0.006)) }
        } catch (err) {
          return { key: c.key, model: c.model, prompt: c.vocab, text: "", ms: Date.now() - started, cost_usd: 0,
                   error: err instanceof Error ? err.message : String(err) }
        }
      }))

      // `only`: keep the other candidates' results, replace these
      const results = Array.isArray(body.only)
        ? [...(test.results ?? []).filter((r: any) => !body.only.includes(r.key)), ...fresh]
        : fresh
      const { error: upErr } = await service.from("voice_tests").update({ results }).eq("id", test.id)
      if (upErr) return fail(upErr.message)
      const usage = fresh.filter(r => !r.error).map(r => ({
        user_id: profile.id, feature: "voice_test", model: r.model, cost_usd: r.cost_usd,
      }))
      if (usage.length) {
        const { error: uErr } = await service.from("ai_usage").insert(usage)
        if (uErr) console.error("ai_usage insert failed:", uErr.message)
      }
      return json({ success: true, results })
    }

    return fail(`Unknown action ${body.action}`)
  } catch (err) {
    return fail(err instanceof AuthError ? err.message : err instanceof Error ? err.message : String(err))
  }
})

/**
 * One transcription. The vocabulary hint helps with names and shop jargon;
 * `english` stops a two-word command in noise being taken for another language.
 * gpt-transcribe takes a list (`languages`); older models a single `language`.
 */
async function transcribe(apiKey: string, audio: Blob, filename: string, model: string, prompt: string, english = false) {
  const form = new FormData()
  form.append("file", audio, filename)
  form.append("model", model)
  if (prompt) form.append("prompt", prompt)
  if (english) form.append(model === "gpt-transcribe" ? "languages[]" : "language", "en")
  const res = await fetch(OPENAI_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message ?? `OpenAI error ${res.status}`)
  return String(data.text ?? "").trim()
}

/** Vehicle names from the fleet plus the shop terms the family uses */
async function vocabulary(service: any) {
  const { data } = await service.from("vehicles").select("name").order("name")
  const names = (data ?? []).map((v: any) => v.name).join(", ")
  return `Vehicle repair talk in a home garage. Vehicle names: ${names}. ` +
    "Terms: Holley Sniper EFI, AFR, IAC, TPS, O2 sensor, OBD, 0W-20, 5W-30, foot-pounds, millimeter, " +
    "caliper bracket, lug nuts, torque, quarts, dexos."
}

/** The production hint: the noise-test winner's vocabulary plus the spoken commands */
async function listeningHint(service: any) {
  return `${await vocabulary(service)} Also: drain plug. Spoken commands: next step, go back, repeat that, done, where am I.`
}

// Awaited: an Edge Function can be stopped once it has responded, losing an unawaited insert
async function logUsage(service: any, userId: string, feature: string, model: string, cost: number) {
  const { error } = await service.from("ai_usage").insert({ user_id: userId, feature, model, cost_usd: round4(cost) })
  if (error) console.error("ai_usage insert failed:", error.message)
}

function fromBase64(b64: string) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

// Handled errors return 200 so supabase.functions.invoke surfaces the message
function fail(error: string) {
  return json({ success: false, error })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}
