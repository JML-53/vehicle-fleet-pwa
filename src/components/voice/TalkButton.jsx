/**
 * Hold to talk (item 29, phase 1b). Press and hold, speak, let go: the clip
 * is transcribed and onTranscript(text) is called ("" = nothing heard).
 * Big enough to press with a knuckle; a long press doesn't open the phone's
 * context menu or scroll the page. Tapping while the mechanic is speaking
 * stops it.
 */
import { Mic, Loader2, Volume2 } from 'lucide-react'

export default function TalkButton({ voice, onTranscript, disabled = false, label = 'Hold to talk' }) {
  const { state } = voice

  async function release() {
    if (voice.state !== 'listening') return
    onTranscript(await voice.stopListening())
  }

  if (state === 'speaking') {
    return (
      <button type="button" onClick={voice.stopSpeaking}
        className="w-full rounded-2xl py-4 bg-amber-500 hover:bg-amber-400 text-white font-bold text-lg inline-flex items-center justify-center gap-2">
        <Volume2 size={22} /> Speaking · tap to stop
      </button>
    )
  }

  return (
    <button type="button" disabled={disabled || state === 'transcribing'}
      onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); voice.startListening() }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={e => e.preventDefault()}
      style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
      className={`w-full rounded-2xl py-4 font-bold text-lg inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50
                  ${state === 'listening' ? 'bg-red-600 text-white' : 'bg-primary-700 hover:bg-primary-800 text-white'}`}>
      {state === 'transcribing'
        ? <><Loader2 size={22} className="animate-spin" /> Listening back…</>
        : state === 'listening'
          ? <><Mic size={22} /> Listening · let go to send</>
          : <><Mic size={22} /> {label}</>}
    </button>
  )
}
