/**
 * LicensePlate — app-drawn Virginia plate with the chosen DMV style's artwork
 * as the logo panel (item 27).
 *
 * The DMV images are whole sample plates ("SAMPLE" in the middle), so only
 * their left portion — where specialty plates carry the logo — is shown, and
 * the real plate number is drawn by the app. No artwork → a Standard plate.
 */

const LOGO_FRACTION = 0.24   // share of the plate width given to the logo panel

const SIZES = {
  sm: { w: 120, num: 22, head: 9,  pad: 4 },
  md: { w: 200, num: 38, head: 13, pad: 6 },
  lg: { w: 280, num: 54, head: 17, pad: 8 },
}

export default function LicensePlate({ plate, state = 'VA', imageUrl, styleName, size = 'md', className = '' }) {
  const s = SIZES[size] ?? SIZES.md
  const h = s.w / 2                       // US plates are 12" × 6"
  const stateName = state === 'VA' ? 'Virginia' : state
  // Shrink the number to fit beside the logo: Oswald ≈ 0.52em per character
  const textWidth  = (s.w - s.pad * 2 - 4) * (imageUrl ? 1 - LOGO_FRACTION : 1) * 0.94
  const chars      = Math.max((plate || '—').length, 1)
  const numberSize = Math.min(s.num, Math.floor(textWidth / (chars * 0.56)))

  return (
    <div
      role="img"
      aria-label={`License plate ${plate || 'unknown'}${styleName ? `, ${styleName}` : ''}`}
      title={styleName || undefined}
      className={`relative bg-white rounded-md shadow-sm overflow-hidden select-none ${className}`}
      style={{ width: s.w, height: h, border: '2px solid #1e3a8a', padding: s.pad, boxSizing: 'border-box' }}
    >
      {/* State header */}
      <div className="text-center leading-none font-semibold tracking-wide"
        style={{ color: '#1e3a8a', fontSize: s.head, fontFamily: 'Georgia, serif', textTransform: 'uppercase' }}>
        {stateName}
      </div>

      <div className="flex items-center" style={{ height: h - s.pad * 2 - s.head - 2 }}>
        {imageUrl && (
          // Logo panel: crop the DMV sample plate (216×144, plate with margins)
          // to its logo window — roughly x 5–27%, y 33–82% of the image — so the
          // sample's own border, "VIRGINIA" header and "SAMPLE" never show.
          <div className="h-full flex-shrink-0 rounded-sm"
            style={{
              width: `${LOGO_FRACTION * 100}%`,
              backgroundImage: `url("${imageUrl}")`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: '490% auto',
              backgroundPosition: '5% 58%',
            }} />
        )}
        <div className="flex-1 text-center leading-none whitespace-nowrap overflow-hidden"
          style={{ color: '#1e3a8a', fontSize: numberSize, fontFamily: "'Oswald', 'Arial Narrow', sans-serif", fontWeight: 600, letterSpacing: '0.04em' }}>
          {plate || '—'}
        </div>
      </div>
    </div>
  )
}
