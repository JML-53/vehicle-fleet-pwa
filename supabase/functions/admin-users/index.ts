/**
 * admin-users — Supabase Edge Function (roadmap items 25 + user half of 10)
 *
 * Admin-only user management. The service role key never leaves this
 * function; the caller must present a valid JWT for a profile with
 * role = 'admin'.
 *
 * Request body: { action, ... }
 *   list                                   → { users: [...] }
 *   invite      { email, display_name, role, origin }
 *   set_role    { user_id, role }
 *   set_disabled{ user_id, disabled }
 *   send_link   { email, origin }          → re-invite if never accepted,
 *                                             otherwise password-reset email
 *
 * Response: { success: true, ... } | { success: false, error }
 * Handled errors return HTTP 200 so supabase.functions.invoke surfaces the
 * message instead of a generic non-2xx error.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const ROLES = ["admin", "member"]
const BAN_FOREVER = "876000h"   // ~100 years

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS })
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    )

    // ── Authenticate caller and require admin ────────────────────────────────
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(jwt)
    if (authErr || !caller) return fail("Not signed in")

    const { data: callerProfile } = await admin
      .from("profiles").select("role").eq("id", caller.id).single()
    if (callerProfile?.role !== "admin") return fail("Admin only")

    const body = await req.json()

    switch (body.action) {
      // ── list ───────────────────────────────────────────────────────────────
      case "list": {
        const { data: authData, error } = await admin.auth.admin.listUsers({ perPage: 200 })
        if (error) return fail(error.message)
        const { data: profiles, error: pErr } = await admin
          .from("profiles").select("id, display_name, role, created_at")
        if (pErr) return fail(pErr.message)
        const byId = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))

        const now = Date.now()
        const users = authData.users.map(u => ({
          id:              u.id,
          email:           u.email,
          display_name:    byId[u.id]?.display_name ?? u.user_metadata?.display_name ?? null,
          role:            byId[u.id]?.role ?? "member",
          invited_at:      u.invited_at ?? null,
          confirmed_at:    u.email_confirmed_at ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
          disabled:        !!u.banned_until && new Date(u.banned_until).getTime() > now,
          is_self:         u.id === caller.id,
        }))
        users.sort((a, b) => (a.display_name ?? a.email ?? "").localeCompare(b.display_name ?? b.email ?? ""))
        return ok({ users })
      }

      // ── invite ─────────────────────────────────────────────────────────────
      case "invite": {
        const email        = String(body.email ?? "").trim().toLowerCase()
        const display_name = String(body.display_name ?? "").trim()
        const role         = ROLES.includes(body.role) ? body.role : "member"
        if (!email || !display_name) return fail("Name and email are required")

        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: redirect(body.origin),
          data:       { display_name },
        })
        if (error) return fail(error.message)

        const { error: upErr } = await admin.from("profiles").upsert({
          id: data.user.id, email, display_name, role,
        })
        if (upErr) return fail(`Invite sent, but profile save failed: ${upErr.message}`)
        return ok({ user_id: data.user.id })
      }

      // ── set_role ───────────────────────────────────────────────────────────
      case "set_role": {
        if (!ROLES.includes(body.role)) return fail("Unknown role")
        if (body.role !== "admin") {
          const { count } = await admin
            .from("profiles").select("id", { count: "exact", head: true })
            .eq("role", "admin").neq("id", body.user_id)
          if (!count) return fail("Can't remove the last admin")
        }
        const { error } = await admin
          .from("profiles").update({ role: body.role }).eq("id", body.user_id)
        if (error) return fail(error.message)
        return ok({})
      }

      // ── set_disabled ───────────────────────────────────────────────────────
      case "set_disabled": {
        if (body.user_id === caller.id) return fail("You can't disable your own account")
        const { error } = await admin.auth.admin.updateUserById(body.user_id, {
          ban_duration: body.disabled ? BAN_FOREVER : "none",
        })
        if (error) return fail(error.message)
        return ok({})
      }

      // ── send_link ──────────────────────────────────────────────────────────
      case "send_link": {
        const email = String(body.email ?? "").trim().toLowerCase()
        const { data: authData, error } = await admin.auth.admin.listUsers({ perPage: 200 })
        if (error) return fail(error.message)
        const target = authData.users.find(u => u.email?.toLowerCase() === email)
        if (!target) return fail("No account with that email")

        const { error: sendErr } = target.email_confirmed_at
          ? await admin.auth.resetPasswordForEmail(email, { redirectTo: redirect(body.origin) })
          : await admin.auth.admin.inviteUserByEmail(email, { redirectTo: redirect(body.origin) })
        if (sendErr) return fail(sendErr.message)
        return ok({ kind: target.email_confirmed_at ? "reset" : "invite" })
      }

      default:
        return fail(`Unknown action: ${body.action}`)
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
})

// Supabase only honours redirect URLs on the project's allow-list, so passing
// the caller's origin through is safe.
function redirect(origin: unknown) {
  return typeof origin === "string" && origin.startsWith("http")
    ? `${origin.replace(/\/$/, "")}/set-password`
    : undefined
}

function ok(body: Record<string, unknown>) {
  return json({ success: true, ...body })
}

function fail(error: string) {
  return json({ success: false, error })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}
