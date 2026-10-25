/**
 * Choose the mechanic's voice and speed (item 29, phase 1b). The list comes
 * from Google (Chirp 3 HD voices in the English accents of VOICE_COUNTRIES),
 * filterable by country and male / female. Choices are remembered per phone.
 * Switching country keeps the same voice name when that country has it
 * (Google uses the same names everywhere), so "Charon" just changes accent.
 */
import { Play } from 'lucide-react'
import { useStoredState } from '@/lib/useStoredState'
import { useVoiceList, unlockAudio, VOICE_COUNTRIES, voiceLabel } from '@/lib/voice'

const SAMPLE = 'Torque the drain plug to eighteen foot-pounds, then refill with eight quarts. Say next when you are ready.'
const GENDERS = [['all', 'All'], ['male', 'Male'], ['female', 'Female']]

export default function VoicePicker({ voice }) {
  const { settings } = voice
  const { data: voices = [], error, isLoading } = useVoiceList(true)
  const [country, setCountry] = useStoredState('voice_filter_country', 'all')
  const [gender, setGender]   = useStoredState('voice_filter_gender', 'all')

  const offered = new Set(voices.map(v => v.locale))
  const shown = voices.filter(v =>
    (country === 'all' || v.locale === country) && (gender === 'all' || v.gender?.toLowerCase() === gender))
  const currentShown = shown.some(v => v.name === settings.voice)

  function pickCountry(c) {
    setCountry(c)
    if (c === 'all') return
    const same = `${c}-Chirp3-HD-${settings.voice.split('-').pop()}`
    if (voices.some(v => v.name === same)) settings.setVoice(same)
  }

  function sample() {
    unlockAudio()
    voice.stopSpeaking()
    voice.speak(SAMPLE)
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select className="field-select w-auto text-sm" value={country} aria-label="Country"
          onChange={e => pickCountry(e.target.value)} disabled={isLoading || !!error}>
          <option value="all">All countries</option>
          {Object.entries(VOICE_COUNTRIES).map(([code, name]) => (
            <option key={code} value={code} disabled={!isLoading && !offered.has(code)}>
              {name}{!isLoading && !offered.has(code) ? ' (not offered by Google)' : ''}
            </option>
          ))}
        </select>
        <div className="inline-flex rounded-full bg-slate-100 p-0.5" role="group" aria-label="Voice type">
          {GENDERS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setGender(k)} aria-pressed={gender === k}
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                gender === k ? 'bg-white text-primary-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="field-select w-auto text-sm" value={settings.voice} aria-label="Voice"
          onChange={e => settings.setVoice(e.target.value)} disabled={isLoading || !!error}>
          {!currentShown && <option value={settings.voice}>{voiceLabel(settings.voice)} (current)</option>}
          {shown.map(v => (
            <option key={v.name} value={v.name}>
              {voiceLabel(v.name)}{gender === 'all' && v.gender ? ` (${v.gender.toLowerCase()})` : ''}
            </option>
          ))}
        </select>
        <select className="field-select w-auto text-sm" value={settings.rate} aria-label="Speed"
          onChange={e => settings.setRate(Number(e.target.value))}>
          {[[0.9, 'Slower'], [1, 'Normal'], [1.15, 'Faster']].map(([r, l]) => <option key={r} value={r}>{l}</option>)}
        </select>
        <button type="button" onClick={sample} className="btn-secondary text-sm inline-flex items-center gap-1 py-1.5">
          <Play size={13} /> Play sample
        </button>
      </div>
      {!isLoading && !error && <p className="text-xs text-slate-400">{shown.length} voice{shown.length === 1 ? '' : 's'} match</p>}
      {error && <p className="text-xs text-amber-700">{error.message}</p>}
    </div>
  )
}
