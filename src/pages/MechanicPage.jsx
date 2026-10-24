/**
 * MechanicPage — chat with the AI mechanic (item 29, phase 1a).
 * Route: /mechanic/:conversationId?  (one route, so starting a chat swaps in
 * the new id without remounting while the answer streams)
 *
 * "Ask" buttons elsewhere open /mechanic with location.state
 * { vehicleId, prompt, entry }: the vehicle is preselected and the question
 * pre-typed, but nothing is sent until the user taps Send.
 *
 * Conversations are shared per vehicle ("Visible to the family"); the author
 * or an admin can delete one. Specs and notes saved from it stay.
 */
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ArrowLeft, Camera, Send, X, Trash2, Plus, Loader2, MessagesSquare } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useProfiles } from '@/lib/changeLog'
import {
  sendToMechanic, uploadChatPhoto, useConversation, useConversations, useSavedCards, useVehicleChoices, toChatItems,
} from '@/lib/mechanic'
import { UserBubble, AssistantBubble } from '@/components/mechanic/ChatItems'

const STARTERS = [
  'Walk me through an oil change on this vehicle',
  'Help me track down a noise',
  'What maintenance is coming up that I can do myself?',
]
const MAX_PHOTOS = 4
// Enter sends on a keyboard; on a phone Enter makes a new line and the button sends
const finePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

export default function MechanicPage() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const qc       = useQueryClient()
  const { user, isAdmin } = useAuth()
  const { data: people = {} }   = useProfiles()
  const { data: vehicles = [] } = useVehicleChoices()
  const { data: conv }          = useConversation(conversationId)
  const { data: saved }         = useSavedCards(conversationId)

  const [vehicleId, setVehicleId] = useState(location.state?.vehicleId || '')
  const [entry, setEntry]         = useState(location.state?.entry || null)
  const [draft, setDraft]         = useState(location.state?.prompt || '')
  const [photos, setPhotos]       = useState([])     // [{ path, media_type, url }]
  const [uploading, setUploading] = useState(false)
  const [live, setLive]           = useState(null)   // turn in progress: { messages, text, activity, pending }
  const [notice, setNotice]       = useState(null)
  const [error, setError]         = useState(null)
  const fileRef   = useRef(null)
  const bottomRef = useRef(null)
  const abortRef  = useRef(null)

  // A new "Ask" (or New chat) while this page is open: start over from its state
  useEffect(() => {
    if (conversationId) return
    setVehicleId(location.state?.vehicleId || '')
    setEntry(location.state?.entry || null)
    setDraft(location.state?.prompt || '')
    setPhotos([]); setNotice(null); setError(null)
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving mid-answer: the function finishes the current step and stops
  useEffect(() => () => abortRef.current?.abort(), [])

  const persisted = conv?.messages ?? []
  const lastSeq   = persisted.length ? persisted[persisted.length - 1].seq : 0
  const items     = toChatItems(live ? [...persisted, ...live.messages.filter(m => m.seq > lastSeq)] : persisted)
  const lastItem  = items[items.length - 1]
  const streamInLast = live && lastItem?.kind === 'assistant'

  useEffect(() => {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 240
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items.length, live?.text, live?.activity])

  async function pickPhotos(e) {
    const files = Array.from(e.target.files || []).slice(0, MAX_PHOTOS - photos.length)
    e.target.value = ''
    if (!files.length) return
    setUploading(true); setError(null)
    try {
      for (const f of files) {
        const p = await uploadChatPhoto(f)
        setPhotos(ps => [...ps, p])
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if ((!text && !photos.length) || live || uploading) return
    const images = photos.map(({ path, media_type }) => ({ path, media_type }))
    setError(null); setNotice(null)
    setLive({ messages: [], text: '', activity: null, pending: { text, photos: photos.length } })
    setDraft(''); setPhotos([])
    window.scrollTo({ top: document.body.scrollHeight })

    let convId = conversationId
    abortRef.current = new AbortController()
    try {
      await sendToMechanic(
        convId
          ? { conversationId: convId, message: text, images }
          : { vehicleId: vehicleId || null, message: text, images, entry },
        ev => {
          if (ev.type === 'start' && !convId) {
            convId = ev.conversationId
            navigate(`/mechanic/${convId}`, { replace: true })
          } else if (ev.type === 'text') {
            setLive(l => l && { ...l, text: l.text + ev.delta, activity: null })
          } else if (ev.type === 'activity') {
            setLive(l => l && { ...l, activity: ev.label })
          } else if (ev.type === 'message') {
            setLive(l => l && { ...l, messages: [...l.messages, ev], text: '', activity: null,
                                pending: ev.role === 'user' ? null : l.pending })
          } else if (ev.type === 'notice') {
            setNotice(ev.text)
          } else if (ev.type === 'error') {
            setError(ev.error)
          }
        },
        abortRef.current.signal,
      )
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
      if (!convId) setDraft(text)   // nothing was saved: give the question back
    } finally {
      if (convId) await qc.invalidateQueries({ queryKey: ['ai_conversation', convId] })
      qc.invalidateQueries({ queryKey: ['ai_conversations'] })
      setLive(null)
    }
  }

  async function remove() {
    if (!window.confirm('Delete this conversation? Specs and notes saved from it stay on the vehicle.')) return
    const { error } = await supabase.from('ai_conversations').delete().eq('id', conversationId)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['ai_conversations'] })
    navigate('/mechanic', { replace: true, state: { vehicleId: conv?.vehicle_id } })
  }

  const vehicleName = conversationId
    ? conv?.vehicles?.name ?? (conv ? 'General question' : '')
    : vehicles.find(v => v.id === vehicleId)?.name
  const canDelete = conv && (conv.created_by === user?.id || isAdmin)
  const busy = !!live

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="bg-primary-900 text-white px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <button onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
            <ArrowLeft size={14} /> Back
          </button>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight">{conv?.title || 'Ask the mechanic'}</h1>
              <p className="text-primary-300 text-xs mt-1">
                {vehicleName ? `${vehicleName} · ` : ''}Visible to the family
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {conversationId && (
                <button type="button" disabled={busy}
                  onClick={() => navigate('/mechanic', { state: { vehicleId: conv?.vehicle_id } })}
                  className="inline-flex items-center gap-1 bg-primary-700 hover:bg-primary-600 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg">
                  <Plus size={13} /> New chat
                </button>
              )}
              {canDelete && (
                <button type="button" disabled={busy} onClick={remove} aria-label="Delete conversation"
                  title="Delete conversation"
                  className="p-1.5 rounded-lg text-primary-300 hover:text-white hover:bg-primary-800">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
          {!conversationId && (
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} disabled={busy}
              aria-label="Vehicle"
              className="mt-3 w-full sm:w-72 rounded-lg bg-primary-800 border border-primary-700 text-white text-sm px-3 py-2">
              <option value="">General question (no vehicle)</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}{v.status !== 'active' ? ` (${v.status})` : ''}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 p-4 max-w-3xl mx-auto w-full space-y-4">
        {!conversationId && !busy && (
          <StartPanel vehicleId={vehicleId} people={people} showStarters={!draft}
            onStarter={s => setDraft(s)} entry={entry} />
        )}

        {items.map(it => it.kind === 'user'
          ? <UserBubble key={it.key} item={it}
              authorName={it.author && it.author !== user?.id ? people[it.author]?.display_name : null} />
          : <AssistantBubble key={it.key} item={it} conversationId={conversationId} saved={saved}
              streamingText={streamInLast && it === lastItem ? live.text : ''}
              activity={streamInLast && it === lastItem ? live.activity : null} />
        )}

        {live?.pending && (
          <UserBubble item={{ text: live.pending.text, images: [] }}
            authorName={live.pending.photos ? `with ${live.pending.photos} photo${live.pending.photos > 1 ? 's' : ''}` : null} />
        )}
        {busy && !streamInLast && (
          <AssistantBubble item={null} streamingText={live.text} activity={live.activity || (!live.text ? 'Thinking…' : null)} />
        )}
        {busy && streamInLast && !live.text && !live.activity && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500 pl-1"><Loader2 size={12} className="animate-spin" /> Working…</p>
        )}

        {notice && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{notice}</p>}
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        {/* Room for the fixed composer; scrolling this into view shows the last message above it */}
        <div ref={bottomRef} className="h-28" aria-hidden="true" />
      </div>

      {/* Composer — pinned just above the bottom nav on phones, beside the sidebar on desktop.
          Fixed, not sticky: Layout's <main> has overflow-y-auto but the window does the
          scrolling, so a sticky element there never sticks. */}
      <div className="fixed z-20 inset-x-0 lg:left-56 bottom-[calc(3.25rem+env(safe-area-inset-bottom,0px))] lg:bottom-0
                      bg-slate-50/95 backdrop-blur border-t border-slate-200 px-4 py-3">
        <div className="max-w-3xl mx-auto space-y-2">
          {photos.length > 0 && (
            <div className="flex gap-2">
              {photos.map(p => (
                <div key={p.path} className="relative">
                  <img src={p.url} alt="Photo to send" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                  <button type="button" aria-label="Remove photo"
                    onClick={() => setPhotos(ps => ps.filter(x => x.path !== p.path))}
                    className="absolute -top-1.5 -right-1.5 bg-slate-700 text-white rounded-full p-0.5"><X size={11} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => fileRef.current?.click()}
              disabled={busy || uploading || photos.length >= MAX_PHOTOS}
              aria-label="Add a photo" title="Add a photo"
              className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:text-primary-700 disabled:opacity-40">
              {uploading ? <Loader2 size={17} className="animate-spin" /> : <Camera size={17} />}
            </button>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && finePointer()) { e.preventDefault(); send() } }}
              placeholder={conversationId ? 'Reply…' : 'Ask the mechanic…'} aria-label="Message"
              style={{ fieldSizing: 'content' }}
              className="field-textarea flex-1 resize-none min-h-[2.5rem] max-h-40 py-2" />
            <button type="button" onClick={send}
              disabled={busy || uploading || (!draft.trim() && !photos.length)}
              aria-label="Send" title="Send"
              className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-lg bg-primary-700 hover:bg-primary-800 text-white disabled:opacity-40">
              {busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pickPhotos} />
        </div>
      </div>
    </div>
  )
}

function StartPanel({ vehicleId, people, showStarters, onStarter, entry }) {
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <p className="text-sm text-slate-700">
          Ask about repairs, maintenance, parts, specs, or a noise you're chasing. Add photos when they help.
          The mechanic can offer cards to save specs and notes to the vehicle — nothing is saved until you tap Save.
        </p>
        {entry?.label && (
          <p className="text-xs text-slate-500">About: <span className="font-medium text-slate-700">{entry.kind} — {entry.label}</span></p>
        )}
        {showStarters && (
          <div className="flex flex-wrap gap-2">
            {STARTERS.map(s => (
              <button key={s} type="button" onClick={() => onStarter(s)}
                className="text-xs bg-primary-50 text-primary-800 hover:bg-primary-100 rounded-full px-3 py-1.5 text-left">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <ConversationList vehicleId={vehicleId} people={people} />
    </div>
  )
}

function ConversationList({ vehicleId, people }) {
  const { data = [], isLoading } = useConversations(vehicleId)
  if (isLoading || !data.length) return null
  return (
    <div className="card">
      <h2 className="card-header">Earlier conversations</h2>
      <ul className="divide-y divide-slate-100">
        {data.map(c => (
          <li key={c.id}>
            <Link to={`/mechanic/${c.id}`} className="flex items-start gap-2 py-2.5 hover:text-primary-700">
              <MessagesSquare size={15} className="text-slate-400 mt-0.5 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-slate-800 truncate">{c.title}</span>
                <span className="block text-xs text-slate-500">
                  {!vehicleId && `${c.vehicles?.name ?? 'General'} · `}
                  {people[c.created_by]?.display_name ?? 'Someone'} · {formatDistanceToNow(parseISO(c.last_message_at), { addSuffix: true })}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
