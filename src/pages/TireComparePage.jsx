/**
 * Item 35 (phase 1): compare tire & wheel setups side by side against the
 * vehicle's current one — sizes, ride height, clearances, speedometer and
 * gearing, plus to-scale side and front diagrams. Nothing is saved to the
 * database yet; each vehicle's comparison is remembered in this browser.
 */
import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useStoredState } from '@/lib/useStoredState'
import {
  parseTireSize, resolveWheel, packageExtents, compareSetup, clearanceLevel,
  fmtIn, fmtSigned,
} from '@/lib/tireMath'
import { Plus, X, Info } from 'lucide-react'

const MAX_OPTIONS = 4
const COLORS = ['#64748b', '#2563eb', '#d97706', '#0d9488', '#9333ea']
const LEVEL_CLASS = { green: 'text-green-700', amber: 'text-amber-700', red: 'text-red-700 font-semibold' }

// ---- Data hooks ----

function useTireVehicles() {
  return useQuery({
    queryKey: ['vehicles', 'tire-picker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, name, year, make, model, status')
        .neq('status', 'inactive')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

// Same shape as VehicleDetail's specs query, so the key is shared safely.
function useSpecs(id) {
  return useQuery({
    queryKey: ['known_specs', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('known_specs')
        .select('*')
        .eq('vehicle_id', id)
        .order('spec_category')
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

/** First tire size found in the vehicle's specs (size specs before brand specs, never the spare). */
function tireFromSpecs(specs) {
  const candidates = (specs || [])
    .filter(s => /tire|tyre/i.test(s.spec_name) && !/spare|pressure|chain/i.test(s.spec_name))
    .sort((a, b) => (/size/i.test(b.spec_name) ? 1 : 0) - (/size/i.test(a.spec_name) ? 1 : 0))
  for (const s of candidates) {
    const t = parseTireSize(s.spec_value)
    if (t) return t.label
  }
  return ''
}

// ---- Page ----

export default function TireComparePage() {
  const [params, setParams] = useSearchParams()
  const [lastVehicle, setLastVehicle] = useStoredState('tireCompare:lastVehicle', '')
  const vehicleId = params.get('vehicle') ?? lastVehicle
  const { data: vehicles = [] } = useTireVehicles()
  const vehicle = vehicles.find(v => v.id === vehicleId)

  function pickVehicle(id) {
    setLastVehicle(id)
    setParams(id ? { vehicle: id } : {}, { replace: true })
  }

  return (
    <div>
      <div className="bg-primary-900 text-white px-5 py-5">
        <h1 className="text-xl font-bold">Tire Compare</h1>
        <p className="text-primary-300 text-sm mt-0.5">
          Compare tire and wheel sizes against the current setup
        </p>
      </div>

      <div className="p-4 max-w-6xl mx-auto w-full space-y-4">
        <div className="card">
          <label className="field-label" htmlFor="tc-vehicle">Vehicle</label>
          <select id="tc-vehicle" className="field-select max-w-sm" value={vehicleId}
            onChange={e => pickVehicle(e.target.value)}>
            <option value="">No vehicle (general comparison)</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id}>{v.name} — {v.year} {v.make} {v.model}</option>
            ))}
          </select>
        </div>

        {/* keyed so each vehicle loads its own remembered comparison */}
        <Comparison key={vehicleId || 'none'} vehicleId={vehicleId} vehicleName={vehicle?.name} />
      </div>
    </div>
  )
}

// ---- Comparison ----

let nextId = Date.now()
const newSetup = (label = '') => ({
  id: String(nextId++), label, tire: '', wheelWidth: '', offsetMm: '', backspacing: '', posMode: 'offset', lift: '',
})

function Comparison({ vehicleId, vehicleName }) {
  const [state, setState] = useStoredState(`tireCompare:${vehicleId || 'none'}`, {
    prefilled: false,
    gaps: { top: '', inner: '', outer: '' },
    axleRatio: '',
    setups: [newSetup('Current'), newSetup('Option A')],
  })
  const { data: specs, isSuccess } = useSpecs(vehicleId)

  // One-time prefill of the current tire from Specs; the flag keeps it from
  // ever overwriting what Joe typed on later visits.
  useEffect(() => {
    if (state.prefilled || (vehicleId && !isSuccess)) return
    const size = tireFromSpecs(specs)
    setState(s => ({
      ...s,
      prefilled: true,
      setups: s.setups.map((x, i) => (i === 0 && !x.tire && size ? { ...x, tire: size } : x)),
    }))
  }, [state.prefilled, vehicleId, isSuccess, specs, setState])

  const updateSetup = (id, patch) =>
    setState(s => ({ ...s, setups: s.setups.map(x => (x.id === id ? { ...x, ...patch } : x)) }))
  const removeSetup = id => setState(s => ({ ...s, setups: s.setups.filter(x => x.id !== id) }))
  const addSetup = () => setState(s => {
    const letter = String.fromCharCode(64 + s.setups.length) // Option A, B, …
    const cur = s.setups[0]
    return { ...s, setups: [...s.setups, { ...newSetup(`Option ${letter}`), tire: cur.tire }] }
  })
  const setGap = (k, v) => setState(s => ({ ...s, gaps: { ...s.gaps, [k]: v } }))

  // Resolve every setup against the current one (index 0).
  const resolved = useMemo(() => {
    const [cur] = state.setups
    const curTire = parseTireSize(cur.tire)
    const curWheel = resolveWheel(cur, null)
    const base = curTire ? { tire: curTire, ext: packageExtents(curTire, curWheel), needsWidth: curWheel.needsWidth } : null
    return state.setups.map((s, i) => {
      const tire = parseTireSize(s.tire)
      const wheel = i === 0 ? curWheel : resolveWheel(s, curWheel)
      const result = tire && base
        ? compareSetup({ tire, wheel, lift: i === 0 ? 0 : s.lift }, base, state.gaps, state.axleRatio)
        : null
      return { setup: s, tire, wheel, result, color: COLORS[i] }
    })
  }, [state])

  const base = resolved[0]
  const ready = resolved.filter(r => r.result)

  return (
    <>
      <div className="card space-y-3">
        <h2 className="card-header mb-0">Measured today {vehicleName ? `on ${vehicleName}` : ''} (optional)</h2>
        <p className="text-xs text-slate-500 -mt-1">
          With the vehicle at normal ride height, measure on the current setup. Each option then shows
          the clearance left; without them you see only how much each gap changes.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <NumField label='Top gap (in)' hint="Tire tread to wheel-well lip, straight up"
            value={state.gaps.top} onChange={v => setGap('top', v)} />
          <NumField label='Inner gap (in)' hint="Tire sidewall to strut / spring / frame"
            value={state.gaps.inner} onChange={v => setGap('inner', v)} />
          <NumField label='Outer gap (in)' hint="Tire face to fender lip (+ = tucked in)"
            value={state.gaps.outer} onChange={v => setGap('outer', v)} />
          <NumField label='Axle ratio' hint="e.g. 3.73 — for gearing numbers"
            value={state.axleRatio} onChange={v => setState(s => ({ ...s, axleRatio: v }))} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {resolved.map((r, i) => (
          <SetupCard key={r.setup.id} r={r} isCurrent={i === 0} curWheel={base.wheel}
            onChange={patch => updateSetup(r.setup.id, patch)}
            onRemove={i > 0 && state.setups.length > 2 ? () => removeSetup(r.setup.id) : null} />
        ))}
        {state.setups.length < MAX_OPTIONS + 1 && (
          <button onClick={addSetup}
            className="card border-dashed flex items-center justify-center gap-2 text-sm font-semibold
                       text-slate-500 hover:text-primary-700 hover:border-primary-300 min-h-[8rem]">
            <Plus size={16} /> Add option
          </button>
        )}
      </div>

      {!base.result ? (
        <div className="card text-sm text-slate-500 flex gap-2">
          <Info size={16} className="flex-shrink-0 mt-0.5" />
          Enter the current tire size to see the comparison.
        </div>
      ) : (
        <>
          <ResultsTable rows={resolved} gaps={state.gaps} axleRatio={state.axleRatio} />
          <Diagrams rows={ready} base={base} gaps={state.gaps} />
          <p className="text-xs text-slate-400 px-1">
            Nominal catalog sizes — real tires vary by brand and grow slightly on wider rims. Gaps are
            static at ride height; leave extra room for suspension compression and full steering lock.
          </p>
        </>
      )}
    </>
  )
}

// ---- Inputs ----

function NumField({ label, hint, value, onChange, placeholder, warn, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label text-xs">{label}</span>
      <input type="text" inputMode="decimal" value={value ?? ''}
        className={`field-input ${warn ? 'border-amber-500 ring-1 ring-amber-400' : ''}`}
        placeholder={placeholder} onChange={e => onChange(e.target.value.replace(/[^\d.\-]/g, ''))} />
      {hint && <span className="block text-[11px] text-slate-400 mt-0.5 leading-tight">{hint}</span>}
    </label>
  )
}

const round = (v, d) => (v == null ? '' : String(+v.toFixed(d)))

function SetupCard({ r, isCurrent, curWheel, onChange, onRemove }) {
  const { setup: s, tire, wheel } = r
  const same = isCurrent ? '' : 'same as current'
  // Show the typed position value as is, and the other one calculated.
  const ownNeedsWidth = wheel.needsWidth && s.posMode === 'backspacing' && s.backspacing !== ''
  const offsetShown = s.posMode !== 'backspacing' ? s.offsetMm : (wheel.inherited ? '' : round(wheel.offsetMm, 0))
  const bsShown = s.posMode === 'backspacing' ? s.backspacing : (wheel.inherited ? '' : round(wheel.backspacing, 2))

  return (
    <div className="card space-y-3" style={{ borderTop: `4px solid ${r.color}` }}>
      <div className="flex items-center gap-2">
        <input className="field-input font-semibold py-1.5" value={s.label} aria-label="Setup name"
          onChange={e => onChange({ label: e.target.value })} />
        {isCurrent && <span className="badge-slate flex-shrink-0">Baseline</span>}
        {onRemove && (
          <button onClick={onRemove} aria-label="Remove option"
            className="text-slate-400 hover:text-red-600 p-1 flex-shrink-0"><X size={16} /></button>
        )}
      </div>

      <label className="block">
        <span className="field-label text-xs">Tire size</span>
        <input className="field-input" value={s.tire} placeholder="275/40R20 or 33x12.50R17"
          autoCapitalize="characters" onChange={e => onChange({ tire: e.target.value })} />
        <span className={`block text-[11px] mt-0.5 ${tire || !s.tire ? 'text-slate-500' : 'text-red-600'}`}>
          {tire
            ? `${fmtIn(tire.diameter, 1)} tall · ${fmtIn(tire.width, 1)} wide · ${fmtIn(tire.sidewall, 1)} sidewall`
            : s.tire ? 'Not recognised — try 275/40R20 or 35x12.50R17' : ' '}
        </span>
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="field-label text-xs">Wheel dia.</span>
          <div className="field-input bg-slate-50 text-slate-600">{tire ? `${tire.rim}"` : '—'}</div>
        </label>
        <NumField label="Width (in)" value={s.wheelWidth} onChange={v => onChange({ wheelWidth: v })}
          warn={ownNeedsWidth}
          placeholder={isCurrent ? 'e.g. 9.5' : curWheel.width != null ? String(curWheel.width) : same} />
        {!isCurrent
          ? <NumField label='Lift vs now (in)' value={s.lift} onChange={v => onChange({ lift: v })} placeholder="0" />
          : <div />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Offset (mm)" value={offsetShown}
          placeholder={ownNeedsWidth ? 'needs width' : isCurrent ? 'e.g. 45' : same}
          onChange={v => onChange({ posMode: 'offset', offsetMm: v })} />
        <NumField label="or Backspacing (in)" value={bsShown}
          placeholder={isCurrent ? 'e.g. 4.5' : same}
          onChange={v => onChange({ posMode: 'backspacing', backspacing: v })} />
      </div>
      {wheel.needsWidth && (
        <p className="text-xs text-amber-700 -mt-1">
          {ownNeedsWidth
            ? "Enter the wheel width: backspacing is measured from the wheel's inner edge, so it can't be placed (or turned into offset) without it."
            : "Inner/outer clearance waits for the current wheel's width."}
        </p>
      )}
    </div>
  )
}

// ---- Results table ----

function Cell({ value, level, sub }) {
  return (
    <td className={`text-right whitespace-nowrap ${level ? LEVEL_CLASS[level] : 'text-slate-800'}`}>
      {value}
      {sub && <span className="block text-[11px] text-slate-400 font-normal">{sub}</span>}
    </td>
  )
}

function ResultsTable({ rows, gaps, axleRatio }) {
  const hasGap = k => gaps[k] !== '' && gaps[k] != null
  // With a measured gap: clearance left (sub = change in the gap). Without: how much further it reaches.
  const gapRow = (k, remainingKey, gapChange, reach) => (r, i) => {
    if (!i) return { value: hasGap(k) ? fmtIn(+gaps[k]) : '—' }
    const res = r.result
    if (!res) return { value: '—' }
    if (k !== 'top' && !res.lateral) return { value: '—', sub: 'needs wheel width' }
    if (hasGap(k)) return { value: fmtIn(res[remainingKey]), level: clearanceLevel(res[remainingKey]), sub: fmtSigned(gapChange(res)) }
    return { value: fmtSigned(reach(res)) }
  }
  const lines = [
    { label: 'Tire', get: r => ({ value: r.tire ? r.tire.label : '—' }) },
    { label: 'Wheel', get: r => ({
      value: r.tire ? `${r.tire.rim}" × ${r.wheel.width ?? '?'}"` : '—',
      level: r.wheel.needsWidth ? 'amber' : null,
      sub: r.wheel.needsWidth ? 'needs wheel width' : r.wheel.positionKnown ? `ET ${Math.round(r.wheel.offsetMm)} · BS ${r.wheel.backspacing != null ? r.wheel.backspacing.toFixed(2) + '"' : '?'}` : 'position not set',
    }) },
    { label: 'Overall diameter', get: (r, i) => r.result && ({
      value: fmtIn(r.result.diameter),
      sub: i ? fmtSigned(r.result.diameterPct, 1, '%') : null,
      level: i && Math.abs(r.result.diameterPct) > 3 ? 'amber' : null,
    }) },
    { label: 'Sidewall height', get: r => r.result && ({ value: fmtIn(r.result.sidewall) }) },
    { label: 'Section width', get: r => r.result && ({ value: fmtIn(r.result.width) }) },
    { label: 'Revs per mile', get: r => r.result && ({ value: Math.round(r.result.revsPerMile) }) },
    { label: 'Real speed at 60 on speedo', get: (r, i) => r.result && ({ value: i ? `${r.result.speedoAt60.toFixed(1)} mph` : '60.0 mph' }) },
    { label: 'Body / ride height', get: (r, i) => r.result && ({ value: i ? fmtSigned(r.result.bodyRise) : '—' }) },
    { label: 'Axle / diff clearance', get: (r, i) => r.result && ({ value: i ? fmtSigned(r.result.axleRise) : '—' }) },
    { label: hasGap('top') ? 'Top gap left' : 'Top gap change',
      get: gapRow('top', 'gapTop', x => x.topGapChange, x => x.topGapChange) },
    { label: hasGap('inner') ? 'Inner gap left' : 'Reaches further inward',
      get: gapRow('inner', 'gapInner', x => -x.inboardGrowth, x => x.inboardGrowth) },
    { label: hasGap('outer') ? 'Outer gap left' : 'Pokes further out',
      get: gapRow('outer', 'gapOuter', x => -x.outboardGrowth, x => x.outboardGrowth) },
    ...(axleRatio ? [
      { label: 'Effective axle ratio', get: r => r.result && ({ value: r.result.effectiveRatio?.toFixed(2) }) },
      { label: 'Ratio to restore', get: (r, i) => r.result && ({ value: i ? r.result.ratioToRestore?.toFixed(2) : '—' }) },
    ] : []),
  ]
  return (
    <div className="card p-0 overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th className="sticky left-0 bg-slate-50 z-10" />
            {rows.map(r => (
              <th key={r.setup.id} className="text-right whitespace-nowrap normal-case">
                <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: r.color }} />
                {r.setup.label || '—'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map(line => (
            <tr key={line.label}>
              <td className="sticky left-0 bg-white text-slate-600 whitespace-nowrap z-10">{line.label}</td>
              {rows.map((r, i) => {
                const cell = line.get(r, i) || { value: '—' }
                return <Cell key={r.setup.id} {...cell} />
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Diagrams ----

const PX = 8 // svg units per inch (all panels share it, so sizes compare by eye)

function Diagrams({ rows, base, gaps }) {
  const top = +gaps.top || 0, inner = +gaps.inner || null, outer = +gaps.outer || null
  const maxD = Math.max(...rows.map(r => r.tire.diameter))
  const maxRise = Math.max(0, ...rows.map(r => r.result.bodyRise))
  const height = maxD + Math.max(top, 2) + maxRise + 3
  const sideW = maxD + 6
  // Front view: one lateral window for every panel so widths compare by eye.
  const placed = rows.filter(r => r.result.lateral)
  const reachIn = Math.max(base.result.ext.inboard + (inner ?? 0), ...placed.map(r => r.result.ext.inboard))
  const reachOut = Math.max(base.result.ext.outboard + (outer ?? 0), ...placed.map(r => r.result.ext.outboard))
  const front = { span: Math.max(reachIn + reachOut + 4, 20), x0: reachIn + 2 }

  return (
    <div className="card">
      <h2 className="card-header">To scale</h2>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r, i) => (
          <figure key={r.setup.id} className="min-w-0">
            <figcaption className="text-sm font-semibold mb-1 flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
              {r.setup.label} <span className="font-normal text-slate-500">{r.tire.label}</span>
            </figcaption>
            <SideView r={r} base={base} isBase={i === 0} top={top} height={height} w={sideW} />
            <p className="text-[11px] text-slate-400 mt-2 mb-0.5 flex justify-between">
              <span>← inboard</span><span>front view, top half</span><span>outboard →</span>
            </p>
            {r.result.lateral ? (
              <FrontView r={r} base={base} isBase={i === 0} inner={inner} outer={outer} height={height}
                cropBelow={maxD * 0.45} cropAbove={maxD + 1.5} {...front} />
            ) : (
              <p className="text-xs text-amber-700 bg-amber-50 rounded p-3">Front view needs the wheel width.</p>
            )}
          </figure>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-3">
        Side view with the ground at the bottom; dashed grey = current tire. Front view looks at the
        driver-side wheel from the front; the solid vertical line is the hub face. All panels share one
        scale (front views are zoomed relative to side views).
        {gaps.top || gaps.inner || gaps.outer ? ' Red dashed = wheel-well lip / suspension / fender from your measurements.' : ''}
      </p>
    </div>
  )
}

function SideView({ r, base, isBase, top, height, w }) {
  const cx = w / 2
  const y = v => height - v // inches above ground → svg y (in inches)
  const D = r.tire.diameter, bD = base.tire.diameter
  const rise = isBase ? 0 : r.result.bodyRise
  const fenderR = bD / 2 + top
  const fenderCy = bD / 2 + rise
  const arc = top
    ? `M ${cx - fenderR} ${y(fenderCy)} A ${fenderR} ${fenderR} 0 0 1 ${cx + fenderR} ${y(fenderCy)}`
    : null
  const gapLeft = isBase ? top : r.result.gapTop
  return (
    <svg viewBox={`0 0 ${w * PX} ${height * PX}`} className="w-full h-auto" role="img"
      aria-label={`Side view of ${r.tire.label}`}>
      <g transform={`scale(${PX})`} strokeWidth={0.15}>
        <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="#94a3b8" />
        <circle cx={cx} cy={y(D / 2)} r={D / 2} fill="#1e293b" />
        <circle cx={cx} cy={y(D / 2)} r={r.tire.rim / 2} fill="#cbd5e1" stroke={r.color} strokeWidth={0.4} />
        <circle cx={cx} cy={y(D / 2)} r={1.2} fill="#64748b" />
        {!isBase && (
          <circle cx={cx} cy={y(bD / 2)} r={bD / 2} fill="none" stroke="#94a3b8" strokeDasharray="0.8 0.6" />
        )}
        {arc && (
          <path d={arc} fill="none" stroke={gapLeft < 0 ? '#dc2626' : '#ef4444'} strokeWidth={0.3}
            strokeDasharray="1 0.6" />
        )}
      </g>
    </svg>
  )
}

function FrontView({ r, base, isBase, inner, outer, height, span, x0, cropBelow, cropAbove }) {
  const xp = v => x0 + v // outboard positive
  const y = v => height - v
  const t = r.tire, c = r.result.ext.centre
  const bt = base.tire, bc = base.result.ext.centre
  const wh = r.wheel
  const bs = wh.backspacing
  const lineX = []
  if (inner != null) lineX.push(xp(-(base.result.ext.inboard + inner)))
  if (outer != null) lineX.push(xp(base.result.ext.outboard + outer))
  return (
    <svg viewBox={`0 ${(height - cropAbove) * PX} ${span * PX} ${(cropAbove - cropBelow) * PX}`}
      className="w-full h-auto bg-slate-50 rounded"
      role="img" aria-label={`Front view of ${t.label}`}>
      <g transform={`scale(${PX})`} strokeWidth={0.15}>
        <line x1={0} x2={span} y1={y(0)} y2={y(0)} stroke="#94a3b8" />
        <rect x={xp(c - t.width / 2)} y={y(t.diameter)} width={t.width} height={t.diameter}
          rx={Math.min(t.sidewall * 0.45, t.width / 3)} fill="#1e293b" />
        {wh.width != null && bs != null && (
          <rect x={xp(-bs)} y={y(t.diameter / 2 + t.rim / 2)} width={wh.width + 1} height={t.rim}
            fill="#cbd5e1" stroke={r.color} strokeWidth={0.3} />
        )}
        {!isBase && (
          <rect x={xp(bc - bt.width / 2)} y={y(bt.diameter)} width={bt.width} height={bt.diameter}
            rx={Math.min(bt.sidewall * 0.45, bt.width / 3)} fill="none" stroke="#94a3b8" strokeDasharray="0.8 0.6" />
        )}
        <line x1={xp(0)} x2={xp(0)} y1={y(0)} y2={y(cropAbove)} stroke={r.color} strokeWidth={0.25} />
        {lineX.map(x => (
          <line key={x} x1={x} x2={x} y1={y(1)} y2={y(cropAbove)} stroke="#ef4444" strokeWidth={0.25}
            strokeDasharray="1 0.6" />
        ))}
      </g>
    </svg>
  )
}
