/**
 * AI mechanic (item 29, phase 1a): talking to the mechanic-chat Edge Function,
 * reading conversations, and turning the saved API messages into what the chat
 * screen shows.
 *
 * Messages are stored exactly as the Claude API sent them (content blocks:
 * text with citations, tool calls, tool results, thinking). toChatItems()
 * folds those into bubbles: user text and photos, and assistant answers with
 * their activity ("Searched: …"), sources and save cards.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const MONTHLY_CAP_USD = 50   // keep in step with MECHANIC_MONTHLY_CAP_USD in the function

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mechanic-chat`

/** Open the mechanic, optionally on a vehicle with a starter question (not sent until the user taps Send). */
export function askMechanic(navigate, { vehicleId, prompt, entry } = {}) {
  navigate('/mechanic', { state: { vehicleId, prompt, entry } })
}

/**
 * Send one message. onEvent receives each streamed event ({ type, … }):
 * start, text, activity, message, notice, done, error. Resolves when the turn ends.
 */
export async function sendToMechanic(body, onEvent, signal) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch(FN_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${session.access_token}`,
      apikey:         import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`The mechanic is unavailable (HTTP ${res.status})`)
  // Errors before the answer starts come back as JSON { success: false, error }
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const j = await res.json()
    throw new Error(j.error || 'The mechanic is unavailable')
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let end
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, end).split('\n').find(l => l.startsWith('data: '))
      buf = buf.slice(end + 2)
      if (line) onEvent(JSON.parse(line.slice(6)))
    }
  }
}

/** Shrink a phone photo (max 1568 px, Claude's sweet spot) and upload it for the chat. */
export async function uploadChatPhoto(file) {
  const blob = await shrinkImage(file, 1568, 0.85)
  const path = `mechanic/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('documents').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return { path, media_type: 'image/jpeg', url: URL.createObjectURL(blob) }
}

async function shrinkImage(file, max, quality) {
  const bitmap = await createImageBitmap(file)
  const scale  = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width  = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Couldn't read that photo"))), 'image/jpeg', quality))
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Vehicles for the mechanic's picker and for naming the vehicle on each save card */
export function useVehicleChoices() {
  return useQuery({
    queryKey: ['vehicles', 'mechanic_choices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('id, name, status').order('name')
      if (error) throw error
      return data
    },
  })
}

export function useConversations(vehicleId) {
  return useQuery({
    queryKey: ['ai_conversations', vehicleId || 'all'],
    queryFn: async () => {
      let q = supabase.from('ai_conversations')
        .select('id, title, vehicle_id, created_by, last_message_at, vehicles(name)')
        .order('last_message_at', { ascending: false })
        .limit(40)
      if (vehicleId) q = q.eq('vehicle_id', vehicleId)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })
}

export function useConversation(id) {
  return useQuery({
    queryKey: ['ai_conversation', id],
    queryFn: async () => {
      const [conv, msgs] = await Promise.all([
        supabase.from('ai_conversations').select('*, vehicles(id, name)').eq('id', id).single(),
        supabase.from('ai_messages').select('seq, role, content, author, created_at')
          .eq('conversation_id', id).order('seq'),
      ])
      if (conv.error) throw conv.error
      if (msgs.error) throw msgs.error
      return { ...conv.data, messages: msgs.data }
    },
    enabled: !!id,
  })
}

/** source_tool_use_id of every card already saved from this conversation */
export function useSavedCards(conversationId) {
  return useQuery({
    queryKey: ['ai_saved_cards', conversationId],
    queryFn: async () => {
      const [specs, notes] = await Promise.all([
        supabase.from('known_specs').select('source_tool_use_id').eq('conversation_id', conversationId),
        supabase.from('vehicle_notes').select('source_tool_use_id').eq('conversation_id', conversationId),
      ])
      if (specs.error) throw specs.error
      if (notes.error) throw notes.error
      return new Set([...specs.data, ...notes.data].map(r => r.source_tool_use_id).filter(Boolean))
    },
    enabled: !!conversationId,
  })
}

// ── Messages → chat items ────────────────────────────────────────────────────

const CONTEXT_PREFIX = '<app_context>'

const ACTIVITY = {
  get_vehicle_record: () => 'Looked at a vehicle record',
  search_records:     i => `Searched your records: ${i?.query ?? ''}`,
  read_document:      () => 'Opened a document',
}

/**
 * [{ seq, role, content, author }] → chat items:
 *   { kind: 'user', key, author, text, images: [storage path] }
 *   { kind: 'assistant', key, text, activities: [label], cards: [{ id, name, input, refused }], sources: [{ url, title }] }
 * One assistant item spans all the API rounds of a turn (tool calls and their
 * results), until the next message the user typed.
 */
export function toChatItems(messages = []) {
  const refused = new Set()
  for (const m of messages) {
    if (m.role !== 'user') continue
    for (const b of m.content) if (b.type === 'tool_result' && b.is_error) refused.add(b.tool_use_id)
  }

  const items = []
  let turn = null
  for (const m of messages) {
    if (m.role === 'user') {
      const typed  = m.content.filter(b => b.type === 'text' && !b.text.startsWith(CONTEXT_PREFIX))
      const images = m.content.filter(b => b.type === 'image' && b.source?.type === 'storage' && b.source.path.startsWith('mechanic/'))
      if (!typed.length && !images.length) continue   // tool results / attached documents: part of the answer
      turn = null
      items.push({
        kind: 'user', key: `u${m.seq}`, author: m.author,
        text: typed.map(b => b.text).join('\n\n'),
        images: images.map(b => b.source.path),
      })
      continue
    }
    if (!turn) {
      turn = { kind: 'assistant', key: `a${m.seq}`, text: '', activities: [], cards: [], sources: [] }
      items.push(turn)
    }
    for (const b of m.content) {
      if (b.type === 'text') {
        turn.text += b.text
        for (const c of b.citations ?? []) if (c.url) addSource(turn, c.url, c.title)
      } else if (b.type === 'server_tool_use') {
        if (b.name === 'web_search') turn.activities.push(`Searched: ${b.input?.query ?? ''}`)
        if (b.name === 'web_fetch' && b.input?.url) {
          turn.activities.push(`Read ${hostname(b.input.url)}`)
          addSource(turn, b.input.url)
        }
      } else if (b.type === 'tool_use') {
        if (b.name.startsWith('propose_')) turn.cards.push({ id: b.id, name: b.name, input: b.input, refused: refused.has(b.id) })
        else if (ACTIVITY[b.name]) turn.activities.push(ACTIVITY[b.name](b.input))
      }
    }
    // Rounds of one turn are joined; keep a paragraph break between them
    if (turn.text && !turn.text.endsWith('\n')) turn.text += '\n\n'
  }
  return items
}

function addSource(turn, url, title) {
  if (!turn.sources.some(s => s.url === url)) turn.sources.push({ url, title: title || hostname(url) })
}

export function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// ── Spec trust (decision 2b) ─────────────────────────────────────────────────

export const SPEC_SOURCE_LABEL = {
  manual:       'manual',
  web:          'web',
  ai_knowledge: 'general knowledge',
  family:       'family',
}

export const VERIFICATION_LABEL = {
  checked_manual:    'Checked against manual',
  worked_as_written: 'Worked as written',
}

/** A spec the mechanic proposed that nobody has confirmed yet */
export const isUnverified = s => !!s.source && s.source !== 'family' && !s.verification
