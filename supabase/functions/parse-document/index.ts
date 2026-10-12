/**
 * parse-document — Supabase Edge Function (items 9, 9.3, 9.4, 24)
 *
 * Reads a vehicle document (receipt, invoice, inspection report, estimate,
 * parts-store receipt…) with Claude and returns structured data for the
 * review screen: document details (incl. a vehicle guess), the service
 * visit + line items, an inspection result, trouble codes and recommended
 * follow-up work. Nothing is written to the database here — the user
 * reviews everything first.
 *
 * Request body (either form):
 *   { documentId }                          — an existing documents row (re-parse)
 *   { storagePath, mimeType, filename }     — a file just uploaded, not yet saved
 *   optional: { vehicleId }                 — vehicle already known (route)
 *
 * Response:
 *   { success: true, data: { document, visit, records, inspection,
 *                             diagnostic_codes, recommended_work } }
 *   { success: false, error: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Anthropic from "npm:@anthropic-ai/sdk"

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const MODEL = "claude-opus-5-5"

const DOC_TYPES     = ["receipt", "estimate", "inspection_report", "registration", "photo", "manual", "other"]
const PRIORITIES    = ["high", "medium", "low", "watch", "conditional"]
const INSP_TYPES    = ["safety", "emissions"]
const INSP_RESULTS  = ["pass", "fail"]

// ── Output schema ────────────────────────────────────────────────────────────
// Structured outputs cap how many fields may use union types (e.g. a nullable
// ["string","null"]), so the schema has NONE: unknown values come back as "",
// amounts/mileage as plain number strings, and the inspection is always present
// with a `present` flag. normalize() turns that back into nulls and numbers, so
// the app sees the same shape as before.

const str  = { type: "string" }            // "" = not shown on the document
const num  = { type: "string" }            // "123.45" or ""  → number | null
const int  = { type: "string" }            // "86644"  or ""  → integer | null
const obj  = (properties: Record<string, unknown>) => ({
  type: "object", additionalProperties: false, properties, required: Object.keys(properties),
})

function buildSchema(categories: string[], vehicleIds: string[]) {
  return obj({
    document: obj({
      vehicle_id:    { type: "string", enum: [...vehicleIds, ""] },
      document_type: { type: "string", enum: DOC_TYPES },
      document_date: str,
      description:   { type: "string" },
    }),
    visit: obj({
      title:          { type: "string" },
      visit_date:     str,
      shop_name:      str,
      work_order:     str,
      invoice_number: str,
      technician:     str,
      total_cost:     num,
      mileage:        int,
      notes:          str,
    }),
    records: {
      type: "array",
      items: obj({
        title:       { type: "string" },
        category:    { type: "string", enum: categories },
        description: str,
        labor_cost:  num,
        parts_cost:  num,
        total_cost:  num,
        notes:       str,
        parts: {
          type: "array",
          items: obj({
            part_name:    { type: "string" },
            part_number:  str,
            manufacturer: str,
            vendor:       str,
            quantity:     num,
            unit_cost:    num,
            total_cost:   num,
          }),
        },
      }),
    },
    inspection: obj({
      present:         { type: "boolean" },
      inspection_type: { type: "string", enum: [...INSP_TYPES, ""] },
      result:          { type: "string", enum: [...INSP_RESULTS, ""] },
      inspection_date: str,
      report_number:   str,
      repairs_needed:  str,
      record_index:    int,
    }),
    diagnostic_codes: {
      type: "array",
      items: obj({ code: { type: "string" }, description: str }),
    },
    recommended_work: {
      type: "array",
      items: obj({
        title:       { type: "string" },
        description: str,
        priority:    { type: "string", enum: PRIORITIES },
      }),
    },
  })
}

function buildPrompt(vehicleList: string, knownVehicle: string | null) {
  return `\
Read this vehicle document (receipt, invoice, work order, inspection report, estimate, parts-store receipt, registration, photo, or manual) for a family fleet and extract everything useful. The family reviews your output before anything is saved, so leave a field as an empty string "" when the document doesn't show it rather than guessing. Write dates as YYYY-MM-DD, money as a plain number like 123.45 (no $ or commas), and mileage as digits only.

Fleet vehicles (id — description):
${vehicleList}
${knownVehicle ? `\nThe user opened this upload from vehicle ${knownVehicle}; choose it unless the document clearly names a different vehicle.\n` : ""}
document
- vehicle_id: match on VIN, plate, year/make/model, or the name written on the document. "" if you can't tell.
- document_type: what kind of document this is. description: one short line a person would recognise it by (e.g. "NTB brake job, front pads & rotors").

visit (the shop visit or purchase the document records)
- title: a few words naming the primary focus of the visit, based on the most important line items (e.g. "Front brakes + alignment", "Failed safety inspection"), not a list of every item.
- shop_name: the shop, dealer, or parts store. Use "Self / Owner" for DIY parts purchases with no labor shop.
- mileage: odometer reading as a whole number if shown.

records (one per distinct labor operation or category of parts)
- Group related parts under one record (oil + filter + hardware). Include EVERY part listed; part numbers, brands, and prices matter.
- Credits or discounts are negative numbers.
- Leave records empty for documents with no service work (registration, photo, manual).

inspection
- present: true only for a state safety or emissions inspection; otherwise false (and leave the other inspection fields "").
- result "fail" for a rejection or failure. repairs_needed: what must be fixed to pass, including any trouble codes.
- record_index: the 0-based index (as digits) of the record that is the inspection itself.

diagnostic_codes: every OBD-II / trouble code observed (e.g. P0300), with its description if given.

recommended_work: work the shop recommends or the document says is still needed but was NOT done on this visit (declined items, "recommend replacing…", failed inspection items). Do not repeat work that was performed.`
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS })
  }

  try {
    const body = await req.json()
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    )

    // ── 1. Resolve the file ──────────────────────────────────────────────────
    let storagePath: string, mimeType: string | null, filename: string | null
    if (body.documentId) {
      const { data: doc, error } = await supabase
        .from("documents").select("storage_path, mime_type, filename")
        .eq("id", body.documentId).single()
      if (error || !doc) return fail(`Document not found: ${error?.message}`)
      ;({ storage_path: storagePath, mime_type: mimeType, filename } = doc)
    } else if (body.storagePath) {
      storagePath = body.storagePath
      mimeType    = body.mimeType ?? null
      filename    = body.filename ?? null
    } else {
      return fail("documentId or storagePath is required")
    }

    const { data: fileBlob, error: storageErr } = await supabase.storage.from("documents").download(storagePath)
    if (storageErr || !fileBlob) return fail(`Storage download failed: ${storageErr?.message}`)

    const mime = mimeType || guessMime(filename ?? storagePath)
    const isPDF = mime === "application/pdf"
    const isImage = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)
    if (!isPDF && !isImage) {
      return fail(`File type "${mime}" can't be read by AI. Supported: PDF, JPEG, PNG, GIF, WEBP.`)
    }

    const base64 = toBase64(new Uint8Array(await fileBlob.arrayBuffer()))
    const fileBlock = isPDF
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image",    source: { type: "base64", media_type: mime,              data: base64 } }

    // ── 2. Context: fleet + categories ───────────────────────────────────────
    const [{ data: vehicles }, { data: categories }] = await Promise.all([
      supabase.from("vehicles").select("id, name, year, make, model, vin, current_plate"),
      supabase.rpc("enum_values", { enum_name: "service_category" }),
    ])
    const fleet = vehicles ?? []
    const describe = (v: Record<string, unknown>) =>
      [v.name, [v.year, v.make, v.model].filter(Boolean).join(" "),
       v.vin && `VIN ${v.vin}`, v.current_plate && `plate ${v.current_plate}`].filter(Boolean).join(", ")
    const vehicleList = fleet.map(v => `${v.id} — ${describe(v)}`).join("\n")
    const known = body.vehicleId ? fleet.find(v => v.id === body.vehicleId) : null

    // ── 3. Ask Claude ────────────────────────────────────────────────────────
    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") })
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",                 // re-run a rare safety decline on a fallback model
      output_config: {
        effort: "medium",                   // extraction: Opus 5.5's default, set explicitly
        format: {
          type: "json_schema",
          schema: buildSchema(categories?.length ? categories : ["other"], fleet.map(v => v.id)),
        },
      },
      messages: [{
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: buildPrompt(vehicleList, known ? `${known.id} (${describe(known)})` : null) },
        ],
      }],
    })

    if (response.stop_reason === "refusal") {
      return fail("The AI declined to read this document. You can enter the details manually.")
    }
    if (response.stop_reason === "max_tokens") {
      return fail("The document was too long to read in one pass. Try a shorter file or enter it manually.")
    }
    const text = response.content.find((b: { type: string }) => b.type === "text") as { text?: string } | undefined
    if (!text?.text) return fail("The AI returned no data.")

    return json({ success: true, data: normalize(JSON.parse(text.text)), model: response.model })
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return fail(`AI service error ${err.status ?? ""}: ${err.message}`)
    }
    return fail(err instanceof Error ? err.message : String(err))
  }
})

// ── Helpers ──────────────────────────────────────────────────────────────────

// "" → null; number strings → numbers. Restores the shape the app expects.
const s = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)
const n = (v: unknown) => {
  const t = s(v)?.replace(/[$,\s]/g, "")
  const x = t != null ? Number(t) : NaN
  return Number.isFinite(x) ? x : null
}
const i = (v: unknown) => { const x = n(v); return x == null ? null : Math.round(x) }

// deno-lint-ignore no-explicit-any
function normalize(d: any) {
  const insp = d.inspection
  return {
    document: {
      vehicle_id:    s(d.document?.vehicle_id),
      document_type: d.document?.document_type || "other",
      document_date: s(d.document?.document_date),
      description:   s(d.document?.description) ?? "",
    },
    visit: {
      title:          s(d.visit?.title) ?? "",
      visit_date:     s(d.visit?.visit_date),
      shop_name:      s(d.visit?.shop_name),
      work_order:     s(d.visit?.work_order),
      invoice_number: s(d.visit?.invoice_number),
      technician:     s(d.visit?.technician),
      total_cost:     n(d.visit?.total_cost),
      mileage:        i(d.visit?.mileage),
      notes:          s(d.visit?.notes),
    },
    // deno-lint-ignore no-explicit-any
    records: (d.records ?? []).map((r: any) => ({
      title:       s(r.title) ?? "",
      category:    r.category || "other",
      description: s(r.description),
      labor_cost:  n(r.labor_cost),
      parts_cost:  n(r.parts_cost),
      total_cost:  n(r.total_cost),
      notes:       s(r.notes),
      // deno-lint-ignore no-explicit-any
      parts: (r.parts ?? []).map((p: any) => ({
        part_name:    s(p.part_name) ?? "",
        part_number:  s(p.part_number),
        manufacturer: s(p.manufacturer),
        vendor:       s(p.vendor),
        quantity:     n(p.quantity) ?? 1,
        unit_cost:    n(p.unit_cost),
        total_cost:   n(p.total_cost),
      })),
    })),
    inspection: insp?.present && insp.inspection_type && insp.result
      ? {
          inspection_type: insp.inspection_type,
          result:          insp.result,
          inspection_date: s(insp.inspection_date),
          report_number:   s(insp.report_number),
          repairs_needed:  s(insp.repairs_needed),
          record_index:    i(insp.record_index),
        }
      : null,
    // deno-lint-ignore no-explicit-any
    diagnostic_codes: (d.diagnostic_codes ?? []).filter((c: any) => s(c.code))
      // deno-lint-ignore no-explicit-any
      .map((c: any) => ({ code: s(c.code), description: s(c.description) })),
    // deno-lint-ignore no-explicit-any
    recommended_work: (d.recommended_work ?? []).filter((w: any) => s(w.title))
      // deno-lint-ignore no-explicit-any
      .map((w: any) => ({ title: s(w.title), description: s(w.description), priority: w.priority || "medium" })),
  }
}

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

function toBase64(bytes: Uint8Array) {
  let binary = ""
  const CHUNK = 8192   // chunked to avoid call-stack overflow on large files
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return ({
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", gif: "image/gif", webp: "image/webp",
  } as Record<string, string>)[ext] ?? "application/octet-stream"
}
