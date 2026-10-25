/**
 * Choose the mechanic's voice and speed (item 29, phase 1b). The list comes
 * from Google (en-US Chirp 3 HD voices); the choice is remembered per phone.
 */
import { Play } from 'lucide-react'
import { useVoiceList, unlockAudio } from '@/lib/voice'

const SAMPLE = 'Torque the drain plug to eighteen foot-pounds, then refill with eight quarts. Say next when you are ready.'

export default function VoicePicker({ voice }) {
  const { settings } = voice
  const { data: voices = [], error, isLoading } = useVoiceList(true)

  function sample() {
    unlockAudio()
    voice.stopSpeaking()
    voice.speak(SAMPLE)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select className="field-select w-auto text-sm" value={settings.voice} aria-label="Voice"
        onChange={e => settings.setVoice(e.target.value)} disabled={isLoading || !!error}>
        {!voices.some(v => v.name === settings.voice) && <option value={settings.voice}>{settings.voice.replace('en-US-Chirp3-HD-', '')}</option>}
        {voices.map(v => (
          <option key={v.name} value={v.name}>{v.label}{v.gender ? ` (${v.gender.toLowerCase()})` : ''}</option>
        ))}
      </select>
      <select className="field-select w-auto text-sm" value={settings.rate} aria-label="Speed"
        onChange={e => settings.setRate(Number(e.target.value))}>
        {[[0.9, 'Slower'], [1, 'Normal'], [1.15, 'Faster']].map(([r, l]) => <option key={r} value={r}>{l}</option>)}
      </select>
      <button type="button" onClick={sample} className="btn-secondary text-sm inline-flex items-center gap-1 py-1.5">
        <Play size={13} /> Play sample
      </button>
      {error && <span className="text-xs text-amber-700">{error.message}</span>}
    </div>
  )
}
