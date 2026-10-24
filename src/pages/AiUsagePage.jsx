/**
 * AiUsagePage — what the AI mechanic costs this month (item 29, admin only).
 * Route: /admin/ai-usage
 *
 * Reads ai_usage (one row per Claude API call, written by mechanic-chat).
 * The month is the UTC calendar month, the same window the function's cap
 * check uses. The Anthropic Console spend limit is the hard stop; the cap
 * here is the app's own friendlier one.
 */
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, AlertTriangle, KeyRound } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useProfiles } from '@/lib/changeLog'
import { MONTHLY_CAP_USD } from '@/lib/mechanic'

function useMonthUsage() {
  return useQuery({
    queryKey: ['ai_usage', 'this_month'],
    queryFn: async () => {
      const start = new Date()
      start.setUTCDate(1)
      start.setUTCHours(0, 0, 0, 0)
      const { data, error } = await supabase.from('ai_usage')
        .select('conversation_id, user_id, model, key_source, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, web_searches, cost_usd, created_at, ai_conversations(title)')
        .gte('created_at', start.toISOString())
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

const usd = n => `$${n.toFixed(2)}`
const sum = (rows, f) => rows.reduce((s, r) => s + Number(r[f] || 0), 0)

function groupBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const k = r[key] ?? 'none'
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return [...m.entries()]
    .map(([k, rs]) => ({ key: k, rows: rs, cost: sum(rs, 'cost_usd') }))
    .sort((a, b) => b.cost - a.cost)
}

export default function AiUsagePage() {
  const navigate = useNavigate()
  const { data: rows = [], isLoading, error } = useMonthUsage()
  const { data: people = {} } = useProfiles()

  const total   = sum(rows, 'cost_usd')
  const pct     = Math.min(100, (total / MONTHLY_CAP_USD) * 100)
  const inputs  = sum(rows, 'input_tokens') + sum(rows, 'cache_write_tokens') + sum(rows, 'cache_read_tokens')
  const cached  = inputs ? Math.round((sum(rows, 'cache_read_tokens') / inputs) * 100) : 0
  // Only the latest call says which key is in use now (rows are newest first)
  const shared  = rows[0]?.key_source === 'shared'
  const byPerson = groupBy(rows, 'user_id')
  const byChat   = groupBy(rows.filter(r => r.conversation_id), 'conversation_id').slice(0, 10)

  return (
    <div>
      <div className="bg-primary-900 text-white px-4 py-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-primary-300 text-sm mb-3 hover:text-white">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-xl font-bold">AI usage</h1>
        <p className="text-primary-300 text-xs mt-0.5">{format(new Date(), 'MMMM yyyy')} · the mechanic</p>
      </div>

      <div className="p-4 max-w-2xl mx-auto space-y-4">
        {isLoading && <p className="text-sm text-slate-400 animate-pulse">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error.message}</p>}

        {shared && (
          <div className="flex gap-2 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg p-3">
            <KeyRound size={16} className="shrink-0 mt-0.5" />
            <p>The mechanic is using the document reader's API key. Create its own key with a $50 limit in the
              Anthropic Console and set it as <code className="text-xs">ANTHROPIC_MECHANIC_API_KEY</code> (roadmap item 29).</p>
          </div>
        )}

        <div className="card space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="text-3xl font-bold text-slate-800">{usd(total)}</p>
            <p className="text-sm text-slate-500">of {usd(MONTHLY_CAP_USD)} cap</p>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-primary-600'}`}
              style={{ width: `${pct}%` }} />
          </div>
          {pct >= 80 && (
            <p className="flex items-center gap-1.5 text-sm text-amber-800">
              <AlertTriangle size={14} />
              {pct >= 100 ? 'The cap is reached: the mechanic is off until the 1st.' : 'Over 80% of this month\'s cap.'}
            </p>
          )}
          <dl className="grid grid-cols-3 gap-2 text-center pt-1">
            <Stat label="API calls" value={rows.length} />
            <Stat label="Web searches" value={sum(rows, 'web_searches')} />
            <Stat label="Input from cache" value={`${cached}%`} />
          </dl>
          <p className="text-xs text-slate-400">
            Cached input costs 5% of the normal price, so a high cache share keeps long conversations cheap.
          </p>
        </div>

        {byPerson.length > 0 && (
          <div className="card">
            <h2 className="card-header">By person</h2>
            <table className="data-table">
              <tbody>
                {byPerson.map(g => (
                  <tr key={g.key}>
                    <td className="text-slate-700">{people[g.key]?.display_name ?? 'Unknown'}</td>
                    <td className="text-slate-500 text-xs">{g.rows.length} calls</td>
                    <td className="text-right font-medium">{usd(g.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {byChat.length > 0 && (
          <div className="card">
            <h2 className="card-header">Costliest conversations</h2>
            <table className="data-table">
              <tbody>
                {byChat.map(g => (
                  <tr key={g.key}>
                    <td className="min-w-0">
                      <Link to={`/mechanic/${g.key}`} className="text-primary-700 hover:underline">
                        {g.rows[0].ai_conversations?.title ?? 'Conversation'}
                      </Link>
                      <span className="block text-xs text-slate-400">{format(parseISO(g.rows[0].created_at), 'MMM d')}</span>
                    </td>
                    <td className="text-right font-medium whitespace-nowrap">{usd(g.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-800">{value}</dd>
    </div>
  )
}
