// Watermark: logo and/or text, with animation (pure, unit tested).
// Logo → ffmpeg overlay x/y expressions (time t); text → ASS events (libass shapes Khmer correctly).
import type { Watermark, WatermarkAnimation } from './types'
import { assColor, assTime } from './captions'

export const WM_ANIMATIONS: WatermarkAnimation[] = ['none', 'pulse', 'corners', 'scroll', 'float']

/** Seconds per animation cycle (corner hop, scroll pass, pulse / float period). */
export const wmEvery = (wm: Pick<Watermark, 'every'>) => Math.max(2, Math.min(60, wm.every ?? 8))

const CORNERS = ['tl', 'tr', 'br', 'bl'] as const

/** ffmpeg overlay "x='…':y='…'" for the logo (W/H = frame, w/h = logo, t = time, m = margin px).
 * Quoted: the expressions contain commas, which would otherwise split the filter graph. */
export function wmOverlayXY(wm: Watermark, m: number): string {
  const [x, y] = wmOverlayExpr(wm, m)
  return `x='${x}':y='${y}'`
}

export function wmOverlayExpr(wm: Watermark, m: number): [string, string] {
  const anim = wm.animation ?? 'none'
  const every = wmEvery(wm)
  const fx = (pos: Watermark['position']) => ({ tl: `${m}`, bl: `${m}`, tr: `W-w-${m}`, br: `W-w-${m}`, center: '(W-w)/2' })[pos]
  const fy = (pos: Watermark['position']) => ({ tl: `${m}`, tr: `${m}`, bl: `H-h-${m}`, br: `H-h-${m}`, center: '(H-h)/2' })[pos]
  if (anim === 'corners') {
    // tl → tr → br → bl, one hop every `every` seconds
    const i = `mod(floor(t/${every}),4)`
    return [`if(eq(${i},0)+eq(${i},3),${m},W-w-${m})`, `if(lt(${i},2),${m},H-h-${m})`]
  }
  if (anim === 'scroll') {
    // right → left across the frame, one pass every `every` seconds, on the row of the chosen position
    return [`W-mod(t*(W+w)/${every},W+w)`, fy(wm.position)]
  }
  if (anim === 'float') {
    // a slow ellipse around the chosen position (stays on screen: amplitude ≤ margin + 2 %)
    const ax = `min(${m},W*0.02)`
    const ay = `min(${m},H*0.02)`
    return [`${fx(wm.position)}+${ax}*sin(2*PI*t/${every})`, `${fy(wm.position)}+${ay}*cos(2*PI*t/${every})`]
  }
  return [fx(wm.position), fy(wm.position)]
}

/** Extra filter for the logo itself: pulse = alpha breathing between 35 % and 100 % of its opacity. */
export function wmLogoPulse(wm: Watermark): string | null {
  if ((wm.animation ?? 'none') !== 'pulse') return null
  const every = wmEvery(wm)
  return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(0.675+0.325*cos(2*PI*T/${every}))'`
}

const AN: Record<Watermark['position'], number> = { tl: 7, tr: 9, bl: 1, br: 3, center: 5 }
const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\r?\n/g, ' ')

/** ASS style + events for the text watermark over [0, duration]. Empty when there is no text. */
/** offsetY: extra distance from the edge (px), e.g. the logo height so the text sits beside the logo instead of on it. */
export function wmTextAss(wm: Watermark, width: number, height: number, duration: number, font: string, offsetY = 0): { style: string; events: string[] } | null {
  const text = escape((wm.text ?? '').trim())
  if (!text || duration <= 0) return null
  const short = Math.min(width, height)
  const size = Math.round(short * Math.max(0.02, Math.min(0.15, wm.textSize ?? 0.045)))
  const m = Math.round(short * Math.max(0, wm.margin))
  const mv = m + Math.max(0, Math.round(offsetY))
  const op = Math.max(0.05, Math.min(1, wm.opacity))
  const color = assColor(wm.textColor ?? '#FFFFFF', op)
  const outline = assColor('#000000', op * 0.85)
  const style = `Style: WM,${font},${size},${color},${color},${outline},${assColor('#000000', op * 0.5)},-1,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(size * 0.07))},${Math.max(1, Math.round(size * 0.05))},${AN[wm.position]},${m},${m},${mv},1`
  const anim = wm.animation ?? 'none'
  const every = wmEvery(wm)
  const ev = (s: number, e: number, tags: string) => `Dialogue: 2,${assTime(s)},${assTime(Math.min(duration, e))},WM,,0,0,0,,{${tags}}${text}`
  const cycles = (fn: (s: number, e: number, i: number) => string[]) => {
    const out: string[] = []
    for (let i = 0, s = 0; s < duration; i++, s += every) out.push(...fn(s, s + every, i))
    return out
  }
  // estimated text width (Khmer/Latin mix) for the scroll path
  const tw = Math.round(text.length * size * 0.6)
  const rowY = wm.position[0] === 't' ? m + size : wm.position[0] === 'b' ? height - m : Math.round(height / 2)
  let events: string[]
  if (anim === 'pulse') {
    const half = Math.round((every * 1000) / 2)
    const lo = assAlpha(op * 0.35)
    events = cycles((s, e) => [ev(s, e, `\\t(0,${half},\\alpha${lo})\\t(${half},${half * 2},\\alpha${assAlpha(op)})`)])
  } else if (anim === 'corners') {
    events = cycles((s, e, i) => [ev(s, e, `\\an${AN[CORNERS[i % 4]]}\\fad(200,200)`)])
  } else if (anim === 'scroll') {
    events = cycles((s, e) => [ev(s, e, `\\an1\\move(${width},${rowY},${-tw},${rowY})`)])
  } else if (anim === 'float') {
    // drift a little and back, around the chosen corner (\pos needs absolute coords: use the margins box)
    const amp = Math.round(Math.min(m, short * 0.02)) || 6
    const half = every / 2
    const [x, y0] = anchorXY(wm.position, width, height, m)
    const y = wm.position[0] === 'b' ? y0 - (mv - m) : y0 + (mv - m)
    events = cycles((s) => [
      ev(s, s + half, `\\move(${x},${y},${x + amp},${y + amp})`),
      ev(s + half, s + every, `\\move(${x + amp},${y + amp},${x},${y})`)
    ])
  } else {
    events = [ev(0, duration, '')]
  }
  return { style, events }
}

/** ASS alpha tag value (&HAA&, 00 = opaque). */
export function assAlpha(opacity: number): string {
  const a = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)
  return `&H${a.toString(16).toUpperCase().padStart(2, '0')}&`
}

/** Anchor point of an \anN position inside the margin box. */
function anchorXY(pos: Watermark['position'], w: number, h: number, m: number): [number, number] {
  const x = pos === 'tl' || pos === 'bl' ? m : pos === 'center' ? Math.round(w / 2) : w - m
  const y = pos === 'tl' || pos === 'tr' ? m : pos === 'center' ? Math.round(h / 2) : h - m
  return [x, y]
}

/** Add the text watermark to an ASS file (from toAss). */
export function withWatermarkText(ass: string, wm: Watermark | undefined, width: number, height: number, duration: number, font: string, offsetY = 0): string {
  const t = wm ? wmTextAss(wm, width, height, duration, font, offsetY) : null
  if (!t) return ass
  const lines = ass.split('\n')
  const at = lines.findIndex((l) => l.startsWith('Style: '))
  lines.splice(at >= 0 ? at + 1 : lines.length, 0, t.style)
  return lines.join('\n').replace(/\n*$/, '\n') + t.events.join('\n') + '\n'
}

export const hasWmImage = (wm?: Watermark) => !!wm?.path
export const hasWmText = (wm?: Watermark) => !!wm?.text?.trim()
