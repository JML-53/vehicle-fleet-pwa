import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

/** Route guard for admin-only pages. Members are sent to the Dashboard. */
export default function RequireAdmin({ children }) {
  const { profile, isAdmin } = useAuth()
  if (!profile) {
    return <div className="p-4 text-slate-400 text-sm animate-pulse">Loading…</div>
  }
  return isAdmin ? children : <Navigate to="/" replace />
}
