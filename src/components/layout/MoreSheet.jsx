/**
 * MoreSheet — mobile bottom sheet for the links that live in the desktop
 * sidebar's lower section (Changes, Dev Roadmap, Users) plus Sign Out.
 */
import { NavLink } from 'react-router-dom'
import { LogOut, X, ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { badgeText } from './secondaryNav'

export default function MoreSheet({ items, onClose }) {
  const { profile, signOut } = useAuth()

  return (
    <div className="fixed inset-0 z-50 lg:hidden" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        onClick={e => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl pb-6"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="text-sm">
            <span className="font-semibold text-slate-800">{profile?.display_name || 'Signed in'}</span>
            <span className="text-slate-400"> · {profile?.role || 'member'}</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X size={18} />
          </button>
        </div>

        <nav className="px-3 space-y-0.5">
          {items.map(({ to, label, Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium ${
                  isActive ? 'bg-primary-50 text-primary-800' : 'text-slate-700 hover:bg-slate-50'
                }`
              }
            >
              <Icon size={18} strokeWidth={1.8} />
              <span className="flex-1">{label}</span>
              {badge > 0
                ? <span className="min-w-[1.25rem] px-1.5 rounded-full bg-amber-400 text-primary-900 text-[10px] font-bold text-center leading-5">{badgeText(badge)}</span>
                : <ChevronRight size={14} className="text-slate-300" />}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={signOut}
            className="flex items-center gap-3 w-full px-3 py-3 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <LogOut size={18} strokeWidth={1.8} />
            Sign Out
          </button>
        </nav>
      </div>
    </div>
  )
}
