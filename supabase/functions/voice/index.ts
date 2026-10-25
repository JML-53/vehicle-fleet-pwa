/**
 * voice — Supabase Edge Function (roadmap item 29, phase 1b)
 *
 * Speech for the mechanic through OpenAI (plan decision 1). The key
 * (OPENAI_API_KEY) stays here; the phone only ever talks to this function.
 *
 * Request body: { action, ... }
 *   transcribe_test { testId }   admin: run one recorded test phrase (voice_tests
 *                                row + its audio in Storage) through each candidate
 *                                transcriber in parallel; saves the results on the
 *                                row and logs the cost in ai_usage.
 * (transcribe and speak for voice mode come after the noise test picks a model)
 *
 * Response: { success: true, results } | { success: false, error }
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
]
const PER_MINUTE_USD: Record<string, number> = {
  "gpt-transcribe": 0.0045, "gpt-4o-transcribe": 0.006, "gpt-4o-mini-transcribe": 0.003,
}
const EXTENSION: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a" }

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS })
  }

  try {
    const { profile, service } = await requireUser(req)
    const body = await req.json()
    const apiKey = Deno.env.get("OPENAI_API_KEY")
    if (!apiKey) return fail("The OpenAI key isn't set up (OPENAI_API_KEY).")

    if (body.action === "transcribe_test") {
      if (profile.role !== "admin") return fail("Admin only")
      const { data: test, error } = await service.from("voice_tests").select("*").eq("id", body.testId).single()
      if (error || !test) return fail("Test recording not found")

      const { data: blob, error: dlErr } = await service.storage.from("documents").download(test.audio_path)
      if (dlErr || !blob) return fail(`Couldn't load the recording: ${dlErr?.message}`)
      const mime = (test.media_type ?? "audio/webm").split(";")[0]
      const filename = `test.${EXTENSION[mime] ?? "webm"}`
      const vocab = await vocabulary(service)

      const results = await Promise.all(CANDIDATES.map(async (c) => {
        const started = Date.now()
        try {
          const text = await transcribe(apiKey, blob, filename, c.model, c.vocab ? vocab : "")
          return { key: c.key, model: c.model, prompt: c.vocab, text, ms: Date.now() - started,
                   cost_usd: round4((Number(test.duration_s ?? 0) / 60) * (PER_MINUTE_USD[c.model] ?? 0.006)) }
        } catch (err) {
          return { key: c.key, model: c.model, prompt: c.vocab, text: "", ms: Date.now() - started, cost_usd: 0,
                   error: err instanceof Error ? err.message : String(err) }
        }
      }))

      const { error: upErr } = await service.from("voice_tests").update({ results }).eq("id", test.id)
      if (upErr) return fail(upErr.message)
      const usage = results.filter(r => !r.error).map(r => ({
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

/** One transcription. The vocabulary hint helps with names and shop jargon. */
async function transcribe(apiKey: string, audio: Blob, filename: string, model: string, prompt: string) {
  const form = new FormData()
  form.append("file", audio, filename)
  form.append("model", model)
  if (prompt) form.append("prompt", prompt)
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
