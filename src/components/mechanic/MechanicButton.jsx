/**
 * Floating "Ask the mechanic" button on every screen (item 29). On a
 * vehicle's pages it opens the mechanic on that vehicle. Hidden on the
 * mechanic itself and on forms, where it would cover the Save button.
 */
import { useLocation, useNavigate } from 'react-router-dom'
import { MessagesSquare } from 'lucide-react'
import { askMechanic } from '@/lib/mechanic'

const HIDDEN_ON = /^\/mechanic|\/(add-[^/]*|edit|new|review|close|upload(-document)?)$/
const VEHICLE   = /^\/vehicles\/([0-9a-f-]{36})/i

export default function MechanicButton() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  if (HIDDEN_ON.test(pathname)) return null
  const vehicleId = pathname.match(VEHICLE)?.[1]

  return (
    <button type="button" onClick={() => askMechanic(navigate, { vehicleId })}
      aria-label="Ask the mechanic" title="Ask the mechanic"
      className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 lg:right-6 z-30
                 w-12 h-12 rounded-full bg-amber-500 hover:bg-amber-400 text-white shadow-lg
                 flex items-center justify-center transition-colors">
      <MessagesSquare size={22} />
    </button>
  )
}
