/**
 * SetPassword — landing page for invite and password-reset email links.
 * Route: /set-password (outside the Layout auth guard)
 *
 * supabase-js picks the session out of the link's URL hash automatically
 * (detectSessionInUrl), so by the time the user submits, they're signed in
 * and updateUser({ password }) just sets the new password.
 */
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

const MIN_LENGTH = 8

export default function SetPassword() {
  const { session, profile, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < MIN_LENGTH) { setError(`Use at least ${MIN_LENGTH} characters.`); return }
    if (password !== confirm)         { setError('Passwords don’t match.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-900 to-primary-700 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🚗</div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Fleet Manager</h1>
          <p className="text-primary-200 text-sm mt-1">
            {profile?.display_name ? `Welcome, ${profile.display_name}` : 'Set your password'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          {loading ? (
            <p className="text-sm text-slate-400 animate-pulse text-center">Checking your link…</p>
          ) : !session ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-slate-600">
                This link has expired or was already used.
              </p>
              <Link to="/login" className="btn-primary inline-block px-4 py-2 text-sm">
                Back to sign in
              </Link>
              <p className="text-xs text-slate-400">
                Use “Forgot password?” there to get a fresh link.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-xs text-slate-500">
                Signed in as <span className="font-medium">{session.user.email}</span>.
                Choose a password for next time.
              </p>
              <div>
                <label className="field-label">New password</label>
                <input type="password" className="field-input" autoComplete="new-password"
                  value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <div>
                <label className="field-label">Confirm password</label>
                <input type="password" className="field-input" autoComplete="new-password"
                  value={confirm} onChange={e => setConfirm(e.target.value)} required />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
              <button type="submit" disabled={busy}
                className="w-full btn-primary py-3 text-base disabled:opacity-60">
                {busy ? 'Saving…' : 'Save password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
