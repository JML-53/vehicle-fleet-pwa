import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Car, ClipboardList, Wrench, FileText
} from 'lucide-react'

const NAV_ITEMS = [
  { to: '/',           label: 'Dashboard',    Icon: LayoutDashboard },
  { to: '/vehicles',   label: 'Vehicles',     Icon: Car },
  { to: '/pending',    label: 'Pending',      Icon: ClipboardList },
  { to: '/maintenance',label: 'Schedule',     Icon: Wrench },
  { to: '/documents',  label: 'Docs',         Icon: FileText },
]

export default function BottomNav() {
  return (
    <nav className="bottom-nav fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200
                    flex items-stretch z-40 lg:hidden">
      {NAV_ITEMS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium
             transition-colors ${
               isActive
                 ? 'text-primary-700'
                 : 'text-slate-400 hover:text-slate-600'
             }`
          }
        >
          <Icon size={20} strokeWidth={1.8} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
