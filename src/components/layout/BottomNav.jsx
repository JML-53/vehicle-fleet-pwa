import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Car, ClipboardList, Wrench, FileText, Menu
} from 'lucide-react'
import MoreSheet from './MoreSheet'
import { useSecondaryNav, badgeText } from './secondaryNav'

const NAV_ITEMS = [
  { to: '/',           label: 'Dashboard',    Icon: LayoutDashboard },
  { to: '/vehicles',   label: 'Vehicles',     Icon: Car },
  { to: '/pending',    label: 'Pending',      Icon: ClipboardList },
  { to: '/maintenance',label: 'Schedule',     Icon: Wrench },
  { to: '/documents',  label: 'Docs',         Icon: FileText },
]

export default function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const { items: secondary, unseen } = useSecondaryNav()
  const { pathname } = useLocation()
  const moreActive = secondary.some(i => pathname.startsWith(i.to))

  // Close the sheet whenever navigation happens
  useEffect(() => { setMoreOpen(false) }, [pathname])

  return (
    <>
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
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={`relative flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium
                      transition-colors ${moreActive ? 'text-primary-700' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <Menu size={20} strokeWidth={1.8} />
          <span>More</span>
          {unseen > 0 && (
            <span className="absolute top-1 right-1/2 translate-x-4 min-w-[1.1rem] px-1 rounded-full
                             bg-amber-400 text-primary-900 text-[10px] font-bold leading-4 text-center">
              {badgeText(unseen)}
            </span>
          )}
        </button>
      </nav>

      {moreOpen && <MoreSheet items={secondary} onClose={() => setMoreOpen(false)} />}
    </>
  )
}
