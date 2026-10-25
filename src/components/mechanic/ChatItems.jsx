/**
 * Chat bubbles for the mechanic (item 29, phase 1a): the user's message with
 * photos, and the mechanic's answer as Markdown with what it looked up, its
 * sources, and any save cards.
 */
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Search, Globe, Loader2, Volume2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import ProposalCard from './ProposalCard'

export function ChatMarkdown({ text }) {
  return (
    <div className="chat-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

function ChatPhoto({ path }) {
  const { data: url } = useQuery({
    queryKey: ['signed_url', path],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
      if (error) throw error
      return data.signedUrl
    },
  })
  if (!url) return <div className="w-24 h-24 rounded-lg bg-primary-600/40" />
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt="Photo sent to the mechanic" className="w-24 h-24 object-cover rounded-lg" />
    </a>
  )
}

export function UserBubble({ item, authorName }) {
  return (
    <div className="flex flex-col items-end">
      {authorName && <span className="text-xs text-slate-400 mb-0.5 mr-1">{authorName}</span>}
      <div className="max-w-[85%] bg-primary-700 text-white rounded-2xl rounded-br-md px-3.5 py-2.5 space-y-2">
        {item.images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end">
            {item.images.map(p => <ChatPhoto key={p} path={p} />)}
          </div>
        )}
        {item.text && <p className="text-sm whitespace-pre-wrap">{item.text}</p>}
      </div>
    </div>
  )
}

export function AssistantBubble({ item, conversation, conversationId, saved, streamingText, activity, onSpeak }) {
  const text = item ? item.text + (streamingText || '') : streamingText || ''
  const activities = item?.activities ?? []
  return (
    <div className="max-w-[95%] bg-white border border-slate-200 rounded-2xl rounded-bl-md px-3.5 py-3 space-y-3 shadow-sm">
      {activities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activities.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[11px] text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 max-w-full">
              <Search size={10} className="shrink-0" /><span className="truncate">{a}</span>
            </span>
          ))}
        </div>
      )}
      {text.trim() && <ChatMarkdown text={text} />}
      {onSpeak && item?.text.trim() && (
        <button type="button" onClick={() => onSpeak(item.text)}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary-700">
          <Volume2 size={13} /> Read aloud
        </button>
      )}
      {activity && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" /> {activity}
        </p>
      )}
      {(item?.cards ?? []).map(c => (
        <ProposalCard key={c.id} card={c} conversation={conversation} conversationId={conversationId}
          saved={saved?.get(c.id)} />
      ))}
      {item?.sources?.length > 0 && (
        <div className="border-t border-slate-100 pt-2">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Sources</p>
          <ul className="space-y-0.5">
            {item.sources.map(s => (
              <li key={s.url} className="text-xs truncate">
                <a href={s.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary-700 hover:underline">
                  <Globe size={10} className="shrink-0" />{s.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
