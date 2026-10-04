/**
 * AdminUsersPage — family account manager (roadmap item 25, user half of 10).
 * Route: /admin/users (RequireAdmin)
 *
 * All work happens in the admin-users Edge Function, which holds the service
 * role key; this page only calls it.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { UserPlus, Mail, ShieldCheck, Shield, Ban, CheckCircle2 } from 'lucide-react'

async function callAdmin(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { ...body, origin: window.location.origin },
  })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Request failed')
  return data
}

function statusOf(u) {
  if (u.disabled)      return { label: 'disabled', cls: 'badge-red' }
  if (!u.confirmed_at) return { label: 'invited',  cls: 'badge-amber' }
  return { label: 'active', cls: 'badge-green' }
}

function ago(ts) {
  return ts ? formatDistanceToNow(parseISO(ts), { addSuffix: true }) : 'never'
}

export default function AdminUsersPage() {
  const qc = useQueryClient()
  const [form, setForm]       = useState({ display_name: '', email: '', role: 'member' })
  const [message, setMessage] = useState(null)   // { kind: 'ok'|'err', text }

  const { data: users = [], isLoading, error: loadErr } = useQuery({
    queryKey: ['admin_users'],
    queryFn: async () => (await callAdmin({ action: 'list' })).users,
    staleTime: 0,
  })

  const action = useMutation({
    mutationFn: callAdmin,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['admin_users'] })
      qc.invalidateQueries({ queryKey: ['profiles'] })
      const text = {
        invite:       `Invite sent to ${vars.email}.`,
        send_link:    `Sign-in link sent to ${vars.email}.`,
        set_role:     'Role updated.',
        set_disabled: vars.disabled ? 'Account disabled.' : 'Account re-enabled.',
      }[vars.action]
      setMessage({ kind: 'ok', text })
      if (vars.action === 'invite') setForm({ display_name: '', email: '', role: 'member' })
    },
    onError: err => setMessage({ kind: 'err', text: err.message }),
  })

  function invite(e) {
    e.preventDefault()
    setMessage(null)
    action.mutate({ action: 'invite', ...form })
  }

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <h1 className="text-xl font-bold">Users</h1>
        <p className="text-primary-300 text-sm mt-0.5">
          Family accounts · members can add and edit; only admins delete
        </p>
      </div>

      <div className="p-4 space-y-4 max-w-3xl mx-auto w-full">
        {/* ── Invite ── */}
        <form onSubmit={invite} className="card space-y-3">
          <h2 className="card-header flex items-center gap-1.5"><UserPlus size={14} /> Invite someone</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="field-label">Name *</label>
              <input className="field-input" value={form.display_name} required
                onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">Email *</label>
              <input type="email" className="field-input" value={form.email} required
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">Role</label>
              <select className="field-select" value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              They’ll get an email link to choose their own password.
            </p>
            <button type="submit" disabled={action.isPending} className="btn-primary disabled:opacity-60">
              {action.isPending && action.variables?.action === 'invite' ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>

        {message && (
          <p className={`text-sm rounded-lg px-3 py-2 ${
            message.kind === 'ok' ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'}`}>
            {message.text}
          </p>
        )}

        {/* ── Users ── */}
        <div className="card overflow-x-auto">
          <h2 className="card-header">Accounts</h2>
          {isLoading && <p className="text-sm text-slate-400 animate-pulse">Loading…</p>}
          {loadErr && (
            <p className="text-sm text-red-600">
              {loadErr.message}. Is the <code>admin-users</code> Edge Function deployed?
            </p>
          )}
          {!!users.length && (
            <table className="data-table min-w-full">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const st = statusOf(u)
                  return (
                    <tr key={u.id}>
                      <td className="font-medium text-slate-800">
                        {u.display_name || '—'}{u.is_self && <span className="text-xs text-slate-400"> (you)</span>}
                      </td>
                      <td className="text-xs text-slate-600">{u.email}</td>
                      <td>
                        <span className={u.role === 'admin' ? 'badge-blue' : 'badge-slate'}>{u.role}</span>
                      </td>
                      <td><span className={st.cls}>{st.label}</span></td>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{ago(u.last_sign_in_at)}</td>
                      <td>
                        <div className="flex items-center gap-1 justify-end">
                          <button type="button" title="Email a sign-in link"
                            onClick={() => action.mutate({ action: 'send_link', email: u.email })}
                            className="text-slate-400 hover:text-primary-600 p-1"><Mail size={14} /></button>
                          {!u.is_self && (
                            <>
                              <button type="button"
                                title={u.role === 'admin' ? 'Make member' : 'Make admin'}
                                onClick={() => {
                                  const role = u.role === 'admin' ? 'member' : 'admin'
                                  if (window.confirm(`Make ${u.display_name || u.email} ${role === 'admin' ? 'an admin' : 'a member'}?`))
                                    action.mutate({ action: 'set_role', user_id: u.id, role })
                                }}
                                className="text-slate-400 hover:text-primary-600 p-1">
                                {u.role === 'admin' ? <ShieldCheck size={14} /> : <Shield size={14} />}
                              </button>
                              <button type="button"
                                title={u.disabled ? 'Re-enable account' : 'Disable account'}
                                onClick={() => {
                                  if (u.disabled || window.confirm(`Disable ${u.display_name || u.email}? They won't be able to sign in.`))
                                    action.mutate({ action: 'set_disabled', user_id: u.id, disabled: !u.disabled })
                                }}
                                className={`p-1 ${u.disabled ? 'text-green-500 hover:text-green-700' : 'text-slate-400 hover:text-red-600'}`}>
                                {u.disabled ? <CheckCircle2 size={14} /> : <Ban size={14} />}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
