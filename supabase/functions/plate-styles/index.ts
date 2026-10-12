/**
 * plate-styles — Supabase Edge Function (item 27)
 *
 * Virginia DMV specialty-plate catalog, fetched on demand.
 *
 * Request body:
 *   { action: "sync" }               → scrape the DMV catalog into plate_styles
 *                                       → { success, count, byCategory }
 *   { action: "image", styleId }     → cache that style's artwork in the
 *                                       plate-styles bucket (first time only)
 *                                       → { success, url }
 *
 * The DMV artwork is copyrighted ("All Rights Reserved"); it's cached only for
 * display inside this private family app, one image per style actually chosen.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const DMV       = "https://www.dmv.virginia.gov"
const SEARCH    = `${DMV}/vehicles/license-plates/search`
const BUCKET    = "plate-styles"
const MAX_PAGES = 25   // per category; the largest has ~14 pages of 10

// Category filter ids from the DMV search page's "Filter Your Results" sidebar
const CATEGORIES: Record<string, number> = {
  "Special Interest": 301,
  "College":          286,
  "Military":         291,
  "Other":            296,
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const body = await req.json()
    const db = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    )

    if (body.action === "sync") {
      const byCategory: Record<string, number> = {}
      const rows: Record<string, unknown>[] = []
      await Promise.all(Object.entries(CATEGORIES).map(async ([category, id]) => {
        const plates = await scrapeCategory(id)
        byCategory[category] = plates.length
        for (const p of plates) rows.push({ state: "VA", category, synced_at: new Date().toISOString(), ...p })
      }))
      if (!rows.length) return fail("The DMV catalog returned no plates — the page layout may have changed.")

      // A plate listed under two categories keeps the first one seen
      const unique = [...new Map(rows.map(r => [r.slug, r])).values()]
      const { error } = await db.from("plate_styles").upsert(unique, { onConflict: "state,slug" })
      if (error) return fail(error.message)
      return ok({ count: unique.length, byCategory })
    }

    if (body.action === "image") {
      const { data: style, error } = await db.from("plate_styles")
        .select("id, slug, source_image_url, image_path").eq("id", body.styleId).single()
      if (error || !style) return fail("Plate style not found")
      if (style.image_path) return ok({ url: publicUrl(db, style.image_path) })
      if (!style.source_image_url) return ok({ url: null })   // e.g. the Standard plate

      const res = await fetch(style.source_image_url)
      if (!res.ok) return fail(`DMV image download failed (${res.status})`)
      const type = res.headers.get("content-type") ?? "image/jpeg"
      const ext  = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"
      const path = `va/${style.slug}.${ext}`
      const { error: upErr } = await db.storage.from(BUCKET)
        .upload(path, await res.arrayBuffer(), { contentType: type, upsert: true })
      if (upErr) return fail(upErr.message)
      await db.from("plate_styles").update({ image_path: path }).eq("id", style.id)
      return ok({ url: publicUrl(db, path) })
    }

    return fail(`Unknown action: ${body.action}`)
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
})

// ── DMV scraping ─────────────────────────────────────────────────────────────

async function scrapeCategory(categoryId: number) {
  const seen = new Map<string, { slug: string; name: string; source_image_url: string | null }>()
  for (let pg = 1; pg <= MAX_PAGES; pg++) {
    const url = `${SEARCH}?f%5B0%5D=plate_category%3A${categoryId}${pg > 1 ? `&pg=${pg}` : ""}`
    const res = await fetch(url, { headers: { "User-Agent": "Limber family fleet app (personal use)" } })
    if (!res.ok) break
    const before = seen.size
    for (const p of parseListing(await res.text())) if (!seen.has(p.slug)) seen.set(p.slug, p)
    if (seen.size === before) break   // past the last page
  }
  return [...seen.values()]
}

/** Each plate is an <a href="/vehicles/license-plates/search/{slug}"> wrapping an <img> and its name */
function parseListing(html: string) {
  const out: { slug: string; name: string; source_image_url: string | null }[] = []
  const anchor = /<a\b[^>]*href="\/vehicles\/license-plates\/search\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi
  for (const m of html.matchAll(anchor)) {
    const [, slug, inner] = m
    const img  = inner.match(/<img\b[^>]*src="([^"]+)"/i)?.[1] ?? null
    const name = decode(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    if (!name) continue
    out.push({ slug, name, source_image_url: img ? new URL(img, DMV).toString() : null })
  }
  return out
}

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function publicUrl(db: any, path: string) {
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

function ok(body: Record<string, unknown>) {
  return json({ success: true, ...body })
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
