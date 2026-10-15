/**
 * Item 35: tire & wheel size math. Pure functions, no React — the Tire
 * Compare page draws from these, and Phase 2 (stored fitment) reuses them.
 *
 * All lengths are inches unless a name says Mm. Values are nominal
 * (catalog) sizes; real tires vary by brand and with the rim they're on.
 *
 * Positions across the wheel are measured from the hub mounting face,
 * inboard (toward the suspension) and outboard (toward the fender lip).
 */

const MM = 25.4
/** The two rim flanges add about ½" each to a wheel's nominal width. */
const FLANGES = 1

/**
 * Parse a tire size anywhere in a string:
 *   metric     275/40ZR20, 275/40 ZR20 106Y, P225/65R17, LT285/70R17, T175/80R19
 *   flotation  35x12.50R17, 33X12.50-15, LT35x12.50R17
 * Returns null when nothing parses.
 */
export function parseTireSize(text) {
  if (!text) return null
  const s = String(text).toUpperCase()

  const flot = s.match(/(\d{2}(?:\.\d+)?)\s*X\s*(\d{1,2}(?:\.\d+)?)\s*(?:Z?R|D|-)\s*(\d{2}(?:\.\d)?)/)
  if (flot) {
    const diameter = +flot[1], width = +flot[2], rim = +flot[3]
    if (diameter > rim) {
      return {
        kind: 'flotation', prefix: s.includes('LT') ? 'LT' : '',
        widthMm: Math.round(width * MM), aspect: Math.round(((diameter - rim) / 2 / width) * 100),
        rim, diameter, width, sidewall: (diameter - rim) / 2,
        label: `${flot[1]}x${flot[2]}R${flot[3]}`,
      }
    }
  }

  const met = s.match(/(?:\b(P|LT|ST|T))?(\d{3})\s*\/\s*(\d{2,3})\s*(?:Z?R|D|B|-)?\s*-?\s*(\d{2}(?:\.\d)?)/)
  if (met) {
    const widthMm = +met[2], aspect = +met[3], rim = +met[4]
    const sidewall = (widthMm * aspect) / 100 / MM
    return {
      kind: 'metric', prefix: met[1] || '',
      widthMm, aspect, rim,
      diameter: rim + 2 * sidewall, width: widthMm / MM, sidewall,
      label: `${met[1] || ''}${widthMm}/${aspect}R${met[4]}`,
    }
  }
  return null
}

/** Wheel position: keep whichever of offset / backspacing was typed; derive the other. */
export function backspacingFromOffset(offsetMm, widthIn) {
  return (widthIn + FLANGES) / 2 + offsetMm / MM
}
export function offsetFromBackspacing(backspacingIn, widthIn) {
  return (backspacingIn - (widthIn + FLANGES) / 2) * MM
}

const num = v => (v === '' || v == null || Number.isNaN(+v) ? null : +v)

/**
 * Resolve one setup's wheel against the current one. A blank wheel width
 * or position means "same as current", so tire-only comparisons still work.
 * Backspacing is measured from the wheel's inner edge, so it can't be placed
 * without a width: then needsWidth is set and the position stays unknown
 * (never silently swapped for the current one).
 *   setup = { wheelWidth, offsetMm, backspacing, posMode: 'offset' | 'backspacing' }
 */
export function resolveWheel(setup, current) {
  const width = num(setup.wheelWidth) ?? (current ? current.width : null)
  const bsTyped = setup.posMode === 'backspacing' && num(setup.backspacing) != null
  if (bsTyped && width == null) {
    return { width, offsetMm: null, backspacing: num(setup.backspacing), positionKnown: false, inherited: false, needsWidth: true }
  }
  let offsetMm = null
  if (bsTyped) {
    offsetMm = offsetFromBackspacing(num(setup.backspacing), width)
  } else if (setup.posMode !== 'backspacing' && num(setup.offsetMm) != null) {
    offsetMm = num(setup.offsetMm)
  }
  const inherited = offsetMm == null
  if (inherited) offsetMm = current ? current.offsetMm : null
  return {
    width,
    offsetMm,
    backspacing: width != null && offsetMm != null ? backspacingFromOffset(offsetMm, width) : null,
    positionKnown: offsetMm != null,
    inherited,
    needsWidth: current ? !!current.needsWidth && inherited : false,
  }
}

/**
 * How far the tire+wheel package reaches inboard and outboard of the hub
 * face. The tire is centred on the wheel centreline (offset moves it
 * inboard); the wheel barrel can stick out past a narrow tire.
 */
export function packageExtents(tire, wheel) {
  const c = -(wheel.offsetMm ?? 0) / MM // centreline, outboard positive
  let inboard = tire.width / 2 - c
  let outboard = tire.width / 2 + c
  if (wheel.width != null && wheel.offsetMm != null) {
    const bs = backspacingFromOffset(wheel.offsetMm, wheel.width)
    inboard = Math.max(inboard, bs)
    outboard = Math.max(outboard, wheel.width + FLANGES - bs)
  }
  return { centre: c, inboard, outboard }
}

/** Clearance colour: comfortable / tight / interferes. */
export function clearanceLevel(inches) {
  if (inches == null) return null
  if (inches < 0) return 'red'
  if (inches < 0.75) return 'amber'
  return 'green'
}

/**
 * Compare one setup against the current one.
 *   gaps  = { top, inner, outer } measured on the vehicle today (optional)
 *   axleRatio optional (e.g. 4.10) for effective-gearing numbers
 * Inner/outer numbers are null while either wheel position is unknown.
 */
export function compareSetup({ tire, wheel, lift = 0 }, base, gaps = {}, axleRatio = null) {
  const lateral = !wheel.needsWidth && !base.needsWidth
  const ext = packageExtents(tire, wheel)
  const dD = tire.diameter - base.tire.diameter
  const ratio = tire.diameter / base.tire.diameter
  const axleRise = dD / 2
  const inboardGrowth = lateral ? ext.inboard - base.ext.inboard : null
  const outboardGrowth = lateral ? ext.outboard - base.ext.outboard : null
  const g = { top: num(gaps.top), inner: num(gaps.inner), outer: num(gaps.outer) }
  const ar = num(axleRatio)

  return {
    diameter: tire.diameter,
    diameterPct: (ratio - 1) * 100,
    sidewall: tire.sidewall,
    width: tire.width,
    circumference: Math.PI * tire.diameter,
    revsPerMile: 63360 / (Math.PI * tire.diameter),
    axleRise,                          // axle / diff / lowest point under the axle
    bodyRise: axleRise + (num(lift) ?? 0), // body / ride height
    topGapChange: (num(lift) ?? 0) - axleRise,
    inboardGrowth,
    outboardGrowth,
    gapTop: g.top == null ? null : g.top + (num(lift) ?? 0) - axleRise,
    gapInner: g.inner == null || !lateral ? null : g.inner - inboardGrowth,
    gapOuter: g.outer == null || !lateral ? null : g.outer - outboardGrowth,
    speedoAt60: 60 * ratio,
    effectiveRatio: ar ? ar / ratio : null,
    ratioToRestore: ar ? ar * ratio : null,
    ext,
    lateral,
  }
}

/** Formatting helpers shared by the page. */
export const fmtIn = (v, d = 2) => (v == null ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}"`)
export const fmtSigned = (v, d = 2, unit = '"') =>
  v == null ? '—' : `${v > 0.004 ? '+' : v < -0.004 ? '−' : '±'}${Math.abs(v).toFixed(d)}${unit}`
