/**
 * Voice noise test (item 29, phase 1b): the phrases to read aloud, and how a
 * transcript is scored against them.
 *
 * Scoring compares *meaning*, not formatting: both sides are normalized
 * ("one hundred forty foot-pounds" and "140 ft-lbs" both become "140 ftlb")
 * before counting word errors, so a model isn't marked wrong for writing
 * numbers or units differently. Key terms — the words that matter on the job
 * (a torque value, a vehicle name, "IAC") — are scored separately.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const PHRASES = [
  { text: 'Torque the lug nuts to 140 foot-pounds',                          keys: ['lug nuts', '140', 'foot-pounds'] },
  { text: 'What size socket fits the oil drain plug on Gandalf?',            keys: ['socket', 'drain plug', 'Gandalf'] },
  { text: 'The Sniper EFI is running rich at idle, AFR around 12.5',         keys: ['Sniper', 'EFI', 'idle', 'AFR', '12.5'] },
  { text: 'Check the IAC and TPS readings on the Holley handheld',           keys: ['IAC', 'TPS', 'Holley', 'handheld'] },
  { text: 'Next step',                                                       keys: ['next step'] },
  { text: 'Repeat that',                                                     keys: ['repeat'] },
  { text: "There's a ticking noise behind the dash when the turn signal is on", keys: ['ticking', 'dash', 'turn signal'] },
  { text: 'Use a 13 millimeter wrench on the caliper bracket bolts',         keys: ['13 millimeter', 'caliper bracket'] },
  { text: 'Add 5 quarts of 0W-20 to The Rover',                              keys: ['5 quarts', '0W-20', 'Rover'] },
  { text: 'Log the mileage on Betsy at 95,529',                              keys: ['mileage', 'Betsy', '95529'] },
]

export const CONDITIONS = {
  quiet:  'Quiet',
  engine: 'Engine running',
  tools:  'Shop vac / compressor',
  other:  'Other noise',
}

export const CANDIDATE_LABEL = {
  'gpt-transcribe+vocab':    'gpt-transcribe + vocabulary',
  'gpt-transcribe':          'gpt-transcribe',
  'gpt-4o-transcribe+vocab': 'gpt-4o-transcribe + vocabulary (older)',
  'gpt-transcribe+vocab2+en': 'gpt-transcribe + vocabulary + commands + English',
}

// ── Normalizing ──────────────────────────────────────────────────────────────

const SMALL = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const isNumberWord = w => w in SMALL || w in TENS || w === 'hundred' || w === 'thousand'

/**
 * "ninety five thousand five hundred twenty nine" → "95529"; "twelve point five" → "12.5";
 * "a hundred forty" → "140"
 */
function wordsToNumbers(text) {
  const words = text.split(/\s+/).filter(Boolean)
  const out = []
  let i = 0
  while (i < words.length) {
    if (words[i] === 'a' && ['hundred', 'thousand'].includes(words[i + 1])) i++   // "a hundred" = one hundred
    if (!isNumberWord(words[i])) { out.push(words[i]); i++; continue }
    let total = 0, current = 0, decimal = '', j = i
    while (j < words.length) {
      const w = words[j]
      if (w in SMALL) current += SMALL[w]
      else if (w in TENS) current += TENS[w]
      else if (w === 'hundred') current = (current || 1) * 100
      else if (w === 'thousand') { total += (current || 1) * 1000; current = 0 }
      else if (w === 'and' && isNumberWord(words[j + 1] ?? '')) { /* "one hundred and forty" */ }
      else if (w === 'point' && (words[j + 1] ?? '') in SMALL) {
        j++
        while (j < words.length && words[j] in SMALL && SMALL[words[j]] < 10) { decimal += SMALL[words[j]]; j++ }
        break
      }
      else break
      j++
    }
    out.push(`${total + current}${decimal ? `.${decimal}` : ''}`)
    i = j
  }
  return out.join(' ')
}

const UNITS = [
  [/\b(foot|ft)\s*(pounds?|lbs?)\b/g, 'ftlb'],
  [/\b(millimet(er|re)s?|mm)\b/g,     'mm'],
  [/\b(quarts?|qts?)\b/g,             'qt'],
]

/** Lowercase words with numbers as digits and units spelled one way */
export function normalizeSpeech(s = '') {
  let t = s.toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')          // 95,529 → 95529
    .replace(/['’]s\b/g, ' is')                   // signal's on → signal is on (both sides alike)
    .replace(/['’]/g, '')                         // don't → dont
    .replace(/[^a-z0-9.\s-]/g, ' ')               // other punctuation → space
    .replace(/\.(?!\d)|(?<!\d)\./g, ' ')          // sentence periods (keeps 12.5)
    .replace(/-/g, ' ')                           // foot-pounds, 0W-20
    .replace(/(\d)([a-z])/g, '$1 $2')             // 13mm → 13 mm (0w20 is rejoined below)
  t = wordsToNumbers(t)
  for (const [re, to] of UNITS) t = t.replace(re, to)
  t = t.replace(/\b(\d+)\s*w\s*(\d+)\b/g, '$1w$2') // 0 w 20 → 0w20
  return t.split(/\s+/).map(w => w.replace(/^\.+|\.+$/g, '')).filter(Boolean)
}

/** Word error rate: (substitutions + insertions + deletions) / words expected */
export function wordErrorRate(expected, actual) {
  const a = normalizeSpeech(expected), b = normalizeSpeech(actual)
  if (!a.length) return b.length ? 1 : 0
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length] / a.length
}

/** Key terms heard correctly: [{ term, hit }] */
export function keyTermHits(keys, actual) {
  const said = ` ${normalizeSpeech(actual).join(' ')} `
  return keys.map(term => ({ term, hit: said.includes(` ${normalizeSpeech(term).join(' ')} `) }))
}

/** Score one test row's results against what was read */
export function scoreTest(test) {
  const keys = PHRASES[test.phrase_no]?.keys ?? []
  return (test.results ?? []).map(r => {
    const hits = r.error ? keys.map(term => ({ term, hit: false })) : keyTermHits(keys, r.text)
    return {
      ...r,
      accuracy: r.error ? 0 : Math.max(0, 1 - wordErrorRate(test.expected, r.text)),
      hits,
    }
  })
}

/** Per candidate: average accuracy, key terms heard, average time — overall, quiet and noisy */
export function summarize(tests) {
  const by = {}
  for (const t of tests) {
    for (const r of scoreTest(t)) {
      const s = (by[r.key] ??= { key: r.key, all: [], quiet: [], noisy: [], keyHits: 0, keyTotal: 0, ms: [], errors: 0 })
      s.all.push(r.accuracy)
      ;(t.condition === 'quiet' ? s.quiet : s.noisy).push(r.accuracy)
      s.keyHits  += r.hits.filter(h => h.hit).length
      s.keyTotal += r.hits.length
      s.ms.push(r.ms)
      if (r.error) s.errors++
    }
  }
  const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  return Object.values(by).map(s => ({
    key: s.key, runs: s.all.length, errors: s.errors,
    accuracy: avg(s.all), quiet: avg(s.quiet), noisy: avg(s.noisy),
    keyRate: s.keyTotal ? s.keyHits / s.keyTotal : null, ms: avg(s.ms),
  })).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))
}

export function useVoiceTests() {
  return useQuery({
    queryKey: ['voice_tests'],
    queryFn: async () => {
      const { data, error } = await supabase.from('voice_tests').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}
