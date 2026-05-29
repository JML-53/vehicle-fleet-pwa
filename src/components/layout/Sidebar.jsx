import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Car, ClipboardList, Wrench,
  FileText, LogOut, ChevronRight, ListTodo
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

const NAV_ITEMS = [
  { to: '/',            label: 'Dashboard',        Icon: LayoutDashboard },
  { to: '/vehicles',    label: 'Vehicles',         Icon: Car },
  { to: '/pending',     label: 'Pending Work',     Icon: ClipboardList },
  { to: '/maintenance', label: 'Maint. Schedule',  Icon: Wrench },
  { to: '/documents',   label: 'Documents',        Icon: FileText },
]

export default function Sidebar() {
  const { profile, signOut } = useAuth()

  return (
    <aside className="hidden lg:flex flex-col w-56 min-h-screen bg-primary-900 text-white">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-primary-800">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🚗</span>
          <div>
            <div className="font-bold text-sm leading-tight">Fleet Manager</div>
            <div className="text-primary-300 text-xs">Limber Family</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-700 text-white'
                  : 'text-primary-200 hover:bg-primary-800 hover:text-white'
              }`
            }
          >
            <Icon size={18} strokeWidth={1.8} />
            <span className="flex-1">{label}</span>
            <ChevronRight size={14} className="opacity-30" />
          </NavLink>
        ))}
      </nav>

      {/* Dev Roadmap — below a thin divider, just above user block */}
      <div className="px-3 pb-2 border-t border-primary-800 pt-2">
        <NavLink
          to="/roadmap"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-primary-700 text-white'
                : 'text-primary-400 hover:bg-primary-800 hover:text-white'
            }`
          }
        >
          <ListTodo size={18} strokeWidth={1.8} />
          <span className="flex-1">Dev Roadmap</span>
          <ChevronRight size={14} className="opacity-30" />
        </NavLink>
      </div>

      {/* User / sign out */}
      <div className="px-3 py-4 border-t border-primary-800">
        <div className="px-3 py-2 text-xs text-primary-300 mb-1">
          {profile?.display_name || 'User'}
          <span className="ml-1 text-primary-500">· {profile?.role || 'member'}</span>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm
                     text-primary-200 hover:bg-primary-800 hover:text-white transition-colors"
        >
          <LogOut size={18} strokeWidth={1.8} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
