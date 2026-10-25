/**
 * Lower-section navigation shared by the desktop Sidebar and the mobile
 * "More" sheet. Order per roadmap item 25: Users sits below Dev Roadmap,
 * just above the signed-in user.
 */
import { BarChart3, BookOpen, CircleDot, History, ListTodo, MessagesSquare, Users } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useUnseenChangeCount } from '@/lib/changeLog'

export function useSecondaryNav() {
  const { isAdmin } = useAuth()
  const unseen = useUnseenChangeCount()
  const items = [
    { to: '/mechanic',    label: 'Mechanic',     Icon: MessagesSquare },
    { to: '/guides',      label: 'Guides',       Icon: BookOpen },
    { to: '/tools/tires', label: 'Tire Compare', Icon: CircleDot },
    { to: '/changes',     label: 'Changes',     Icon: History,  badge: unseen },
    { to: '/roadmap',     label: 'Dev Roadmap', Icon: ListTodo },
    ...(isAdmin ? [
      { to: '/admin/users',    label: 'Users',    Icon: Users },
      { to: '/admin/ai-usage', label: 'AI usage', Icon: BarChart3 },
    ] : []),
  ]
  return { items, unseen }
}

/** "99+" style badge text */
export function badgeText(n) {
  return n > 99 ? '99+' : String(n)
}
