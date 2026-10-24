/**
 * Shared caller check for Edge Functions (item 29).
 *
 * The function gateway only checks that the request carries a valid JWT for
 * this project — and the public anon key shipped in the app is one. Functions
 * that spend money or read private data must also confirm a real signed-in
 * user, which is what requireUser does.
 *
 * Returns:
 *   user     — the auth user
 *   profile  — { id, display_name, role }
 *   service  — service-role client (bypasses RLS; use for server-owned writes)
 *   asUser   — client acting as the caller (RLS applies; use for reading fleet data)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

export class AuthError extends Error {}

export async function requireUser(req: Request) {
  const url = Deno.env.get("SUPABASE_URL") ?? ""
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  const { data: { user }, error } = await service.auth.getUser(jwt)
  if (error || !user) throw new AuthError("Not signed in")

  const { data: profile } = await service
    .from("profiles").select("id, display_name, role").eq("id", user.id).single()
  if (!profile) throw new AuthError("No profile for this account")

  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth:   { persistSession: false },
  })

  return { user, profile, service, asUser }
}
