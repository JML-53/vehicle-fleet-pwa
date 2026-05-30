/**
 * parse-document — Supabase Edge Function
 *
 * Receives a document ID, downloads the file from Supabase Storage,
 * sends it to Claude for structured extraction, and returns a JSON
 * object ready to pre-populate the AddEditServiceVisit form.
 *
 * Request body:
 *   { documentId: string, vehicleName: string }
 *
 * Response:
 *   { success: true, data: { visit: {...}, records: [...] } }
 *   { success: false, error: string, raw?: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const EXTRACTION_PROMPT = (vehicleName: string) => `\
You are analyzing a vehicle service document (receipt, invoice, inspection report, work order, or auto-parts store receipt) for the vehicle: ${vehicleName}.

Extract ALL service information and return it as a single JSON object with this exact structure:

{
  "visit": {
    "visit_date": "YYYY-MM-DD or null",
    "shop_name": "name of the shop, garage, dealer, or parts store. Use 'Self / Owner' for DIY parts purchases with no labor shop.",
    "work_order": "WO / RO / ticket number or null",
    "invoice_number": "invoice, receipt, or confirmation number or null",
    "technician": "technician or advisor name or null",
    "total_cost": total amount paid as a number or null,
    "notes": "vehicle mileage at service if shown, plus any other general notes"
  },
  "records": [
    {
      "title": "concise summary title for this line item (e.g. 'Engine Oil & Filter Change', 'Front Brake Pads & Rotors')",
      "category": "one of exactly: oil_change | brakes | tires | suspension | electrical | ac_hvac | engine | transmission | inspection | registration | modification | diagnostic | fuel_system | cooling | other",
      "description": "full description of the work performed or parts purchased for this line item",
      "labor_cost": labor charge as a number or null,
      "parts_cost": parts charge for this item as a number or null,
      "total_cost": total for this line item as a number or null,
      "notes": "any notes specific to this line item",
      "parts": [
        {
          "part_name": "full part name as shown",
          "part_number": "part or SKU number or null",
          "manufacturer": "brand or manufacturer or null",
          "vendor": "supplier or store or null",
          "quantity": quantity as a number (default 1 if not shown),
          "unit_cost": unit price as a number or null,
          "total_cost": total cost for this part as a number or null
        }
      ]
    }
  ]
}

Extraction rules:
- Create one record entry per distinct labor operation or category of parts.
- For invoices with many parts (oil + filter + hardware), group related parts under one record.
- Include EVERY part listed — part numbers, brands, and prices are especially important.
- If the document shows mileage, put it in visit.notes (e.g. "Mileage: 89,940").
- For a parts store receipt with no labor, visit_type should reflect that (shop_name = store name).
- If a cost is shown as a credit or discount, represent it as a negative number.
- Return ONLY the raw JSON object — no markdown fences, no explanation text.`

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS })
  }

  try {
    const { documentId, vehicleName } = await req.json()

    if (!documentId) {
      return json({ success: false, error: "documentId is required" }, 400)
    }

    // ── 1. Look up document record ───────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    )

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("id, storage_path, mime_type, filename, document_type")
      .eq("id", documentId)
      .single()

    if (docErr || !doc) {
      return json({ success: false, error: `Document not found: ${docErr?.message}` }, 404)
    }

    // ── 2. Download file from Storage ────────────────────────────────────────
    const { data: fileBlob, error: storageErr } = await supabase.storage
      .from("documents")
      .download(doc.storage_path)

    if (storageErr || !fileBlob) {
      return json({ success: false, error: `Storage download failed: ${storageErr?.message}` }, 500)
    }

    // ── 3. Convert to base64 ─────────────────────────────────────────────────
    const arrayBuffer = await fileBlob.arrayBuffer()
    const bytes       = new Uint8Array(arrayBuffer)
    let binary        = ""
    // Process in chunks to avoid call stack overflow on large files
    const CHUNK = 8192
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    const base64 = btoa(binary)

    // ── 4. Build Claude content block ────────────────────────────────────────
    const mimeType = doc.mime_type || guessMime(doc.filename ?? doc.storage_path)
    const isPDF    = mimeType === "application/pdf"

    // Claude supports: image/jpeg, image/png, image/gif, image/webp, application/pdf
    const supportedImage = ["image/jpeg","image/png","image/gif","image/webp"].includes(mimeType)

    if (!isPDF && !supportedImage) {
      return json({
        success: false,
        error: `File type "${mimeType}" is not supported for AI analysis. ` +
               "Supported types: PDF, JPEG, PNG, GIF, WEBP.",
      }, 400)
    }

    const fileBlock = isPDF
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image",    source: { type: "base64", media_type: mimeType,           data: base64 } }

    // ── 5. Call Claude API ───────────────────────────────────────────────────
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")
    if (!anthropicKey) {
      return json({ success: false, error: "ANTHROPIC_API_KEY secret not configured" }, 500)
    }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta":  "pdfs-2024-09-25",  // required for PDF document blocks
      },
      body: JSON.stringify({
        model:      "claude-opus-4-6",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT(vehicleName || "unknown vehicle") },
            fileBlock,
          ],
        }],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      return json({ success: false, error: "Claude API error", detail: errText }, 500)
    }

    const claudeResult = await claudeRes.json()
    const rawText      = claudeResult.content?.[0]?.text ?? ""

    // ── 6. Parse Claude's response ───────────────────────────────────────────
    try {
      // Strip accidental markdown code fences
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/\s*```\s*$/m, "")
        .trim()
      const parsed = JSON.parse(cleaned)
      return json({ success: true, data: parsed, documentId })
    } catch (_e) {
      return json({
        success: false,
        error: "Claude returned a response that could not be parsed as JSON. " +
               "Try again or enter the data manually.",
        raw: rawText,
      }, 500)
    }

  } catch (err) {
    return json({ success: false, error: String(err) }, 500)
  }
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic", heif: "image/heic",
  }
  return map[ext] ?? "application/octet-stream"
}
