// Stickers (image / GIF / video) and styled text on the video (pure, unit tested).
// Times are SOURCE seconds (like the timeline); positions are fractions of the OUTPUT frame (centre x / y).
// Text is burned with libass (Khmer shapes correctly); stickers are ffmpeg overlays.

import { assColor, assTime } from './captions'

export type OverlayAnim = 'none' | 'fade' | 'pop' | 'float'

interface OverlayBase {
  id: string
  start: number
  end: number
  /** centre, 0..1 of the output frame */
  x: number
  y: number
  anim: OverlayAnim
  opacity: number
}

export interface StickerOverlay extends OverlayBase {
  kind: 'sticker'
  /** image / GIF / video file */
  path: string
  name: string
  /** width, share of the frame width */
  w: number
}

export interface TextOverlay extends OverlayBase {
  kind: 'text'
  text: string
  style: TextStyleId
  /** text height, share of the frame height */
  size: number
  font?: string
}

export type Overlay = StickerOverlay | TextOverlay

// ───────── text styles ─────────

export type TextStyleId =
  | 'classic' | 'yellow' | 'neonPink' | 'neonCyan' | 'fire' | 'gold' | 'comic' | 'retro'
  | 'shadow3d' | 'boxBlack' | 'boxRed' | 'highlight' | 'pastel' | 'mint' | 'ice' | 'minimal'

export interface TextStyle {
  name: string
  fill: string
  outline?: string
  /** outline width, share of the font size */
  outlineW: number
  shadow?: string
  /** hard shadow offset, share of the font size */
  shadowD: number
  /** coloured box behind the text */
  box?: string
  /** soft glow around the text */
  glow?: string
  bold: boolean
}

export const TEXT_STYLES: Record<TextStyleId, TextStyle> = {
  classic: { name: 'Classic', fill: '#FFFFFF', outline: '#000000', outlineW: 0.08, shadow: '#000000', shadowD: 0.04, bold: true },
  yellow: { name: 'Yellow bold', fill: '#FFD400', outline: '#000000', outlineW: 0.1, shadow: '#000000', shadowD: 0.05, bold: true },
  neonPink: { name: 'Neon pink', fill: '#FFFFFF', outline: '#FF2D95', outlineW: 0.04, shadowD: 0, glow: '#FF2D95', bold: true },
  neonCyan: { name: 'Neon cyan', fill: '#FFFFFF', outline: '#00E5FF', outlineW: 0.04, shadowD: 0, glow: '#00E5FF', bold: true },
  fire: { name: 'Fire', fill: '#FFE14D', outline: '#FF4500', outlineW: 0.08, shadowD: 0, glow: '#FF2200', bold: true },
  gold: { name: 'Gold', fill: '#FFD76A', outline: '#6B4200', outlineW: 0.08, shadow: '#000000', shadowD: 0.05, bold: true },
  comic: { name: 'Comic', fill: '#FFFFFF', outline: '#000000', outlineW: 0.14, shadow: '#000000', shadowD: 0.09, bold: true },
  retro: { name: 'Retro', fill: '#33F5FF', outline: '#000000', outlineW: 0.05, shadow: '#FF2BD6', shadowD: 0.1, bold: true },
  shadow3d: { name: '3D shadow', fill: '#FFFFFF', outlineW: 0, shadow: '#000000', shadowD: 0.12, bold: true },
  boxBlack: { name: 'Black box', fill: '#FFFFFF', outlineW: 0.25, shadowD: 0, box: '#000000', bold: true },
  boxRed: { name: 'Red box', fill: '#FFFFFF', outlineW: 0.25, shadowD: 0, box: '#E11D48', bold: true },
  highlight: { name: 'Highlight', fill: '#111111', outlineW: 0.25, shadowD: 0, box: '#FFE500', bold: true },
  pastel: { name: 'Pastel', fill: '#FFC2E2', outline: '#FFFFFF', outlineW: 0.1, shadow: '#B0006A', shadowD: 0.04, bold: true },
  mint: { name: 'Mint', fill: '#B8FFDA', outline: '#008F50', outlineW: 0.08, shadow: '#003D22', shadowD: 0.04, bold: true },
  ice: { name: 'Ice', fill: '#E8F7FF', outline: '#3AA0FF', outlineW: 0.06, shadowD: 0, glow: '#9FD8FF', bold: true },
  minimal: { name: 'Minimal', fill: '#FFFFFF', outlineW: 0, shadow: '#000000', shadowD: 0.03, bold: false }
}
export const TEXT_STYLE_IDS = Object.keys(TEXT_STYLES) as TextStyleId[]

/** CSS for the preview (same look as the export, near enough). `px` = font size in pixels. */
export function textCss(st: TextStyle, px: number): Record<string, string | number> {
  const shadows: string[] = []
  if (st.glow) shadows.push(`0 0 ${px * 0.25}px ${st.glow}`, `0 0 ${px * 0.5}px ${st.glow}`)
  if (st.shadow && st.shadowD) shadows.push(`${px * st.shadowD}px ${px * st.shadowD}px 0 ${st.shadow}`)
  return {
    color: st.fill,
    fontWeight: st.bold ? 800 : 500,
    fontSize: px,
    lineHeight: 1.25,
    WebkitTextStroke: st.outline && st.outlineW ? `${px * st.outlineW * 2}px ${st.outline}` : '0',
    paintOrder: 'stroke fill',
    textShadow: shadows.join(', ') || 'none',
    background: st.box ?? 'transparent',
    padding: st.box ? `${px * 0.12}px ${px * 0.3}px` : 0,
    borderRadius: st.box ? px * 0.12 : 0,
    whiteSpace: 'pre'
  }
}

const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N')

/**
 * ASS styles + events for text overlays (already moved to OUTPUT time). Appended to the burn ASS.
 * A glow is a blurred, wide outline under the crisp text (two layers).
 */
export function textOverlayAss(items: Array<TextOverlay & { windows: Array<{ start: number; end: number }> }>, w: number, h: number, defaultFont: string): { styles: string[]; events: string[] } {
  const styles: string[] = []
  const events: string[] = []
  items.forEach((o, k) => {
    const st = TEXT_STYLES[o.style] ?? TEXT_STYLES.classic
    const size = Math.max(8, Math.round(h * Math.min(0.4, Math.max(0.02, o.size))))
    const font = o.font || defaultFont
    const box = !!st.box
    const name = `Ov${k}`
    const back = box ? assColor(st.box!, o.opacity) : assColor(st.shadow ?? '#000000', st.shadow ? o.opacity : 0)
    const outline = box ? assColor(st.box!, o.opacity) : assColor(st.outline ?? '#000000', st.outline ? o.opacity : 0)
    styles.push(
      `Style: ${name},${font},${size},${assColor(st.fill, o.opacity)},${assColor(st.fill, o.opacity)},${outline},${back},${st.bold ? -1 : 0},0,0,0,100,100,0,0,${box ? 3 : 1},${(size * st.outlineW).toFixed(1)},${(size * st.shadowD).toFixed(1)},5,0,0,0,1`
    )
    const px = Math.round(o.x * w)
    const py = Math.round(o.y * h)
    for (const win of o.windows) {
      const dur = Math.round((win.end - win.start) * 1000)
      const anim =
        o.anim === 'fade'
          ? `\\fad(250,250)`
          : o.anim === 'pop'
            ? `\\fscx40\\fscy40\\t(0,220,\\fscx112\\fscy112)\\t(220,320,\\fscx100\\fscy100)`
            : o.anim === 'float'
              ? `\\move(${px},${py + Math.round(h * 0.015)},${px},${py - Math.round(h * 0.015)},0,${dur})`
              : ''
      const pos = o.anim === 'float' ? '' : `\\pos(${px},${py})`
      const tag = `{\\an5${pos}${anim}}`
      if (st.glow) {
        const g = assColor(st.glow, o.opacity * 0.85)
        events.push(`Dialogue: 3,${assTime(win.start)},${assTime(win.end)},${name},,0,0,0,,{\\an5${pos}${anim}\\1a&HFF&\\3c${g.slice(0, 2)}${g.slice(4)}&\\3a&H${g.slice(2, 4)}&\\bord${Math.round(size * 0.18)}\\blur${Math.round(size * 0.12)}\\shad0}${esc(o.text)}`)
      }
      events.push(`Dialogue: 4,${assTime(win.start)},${assTime(win.end)},${name},,0,0,0,,${tag}${esc(o.text)}`)
    }
  })
  return { styles, events }
}

/** Add overlay styles + events to an ASS document (after its other styles / events). */
export function withOverlayText(ass: string, add: { styles: string[]; events: string[] }): string {
  if (!add.events.length) return ass
  const lines = ass.split('\n')
  const at = lines.findIndex((l) => l.startsWith('Style: '))
  lines.splice(at >= 0 ? at + 1 : lines.length, 0, ...add.styles)
  return lines.join('\n').replace(/\n*$/, '\n') + add.events.join('\n') + '\n'
}

// ───────── stickers (ffmpeg) ─────────

export const isGif = (p: string) => /\.gif$/i.test(p)
export const isVideo = (p: string) => /\.(mp4|mov|webm|mkv|m4v)$/i.test(p)

/** `enable=` expression: on in any of the windows. */
export const windowsExpr = (wins: Array<{ start: number; end: number }>) => wins.map((v) => `between(t,${v.start.toFixed(3)},${v.end.toFixed(3)})`).join('+')

/** Input options for a sticker file (an image loops; a GIF / video starts playing when the sticker appears). */
export function stickerInput(o: StickerOverlay, firstStart: number, fps: number): string[] {
  if (isVideo(o.path)) return ['-stream_loop', '-1', '-itsoffset', firstStart.toFixed(3), '-i', o.path]
  if (isGif(o.path)) return ['-ignore_loop', '0', '-itsoffset', firstStart.toFixed(3), '-i', o.path]
  return ['-loop', '1', '-framerate', String(Math.round(fps)), '-i', o.path]
}

/** Graph lines that put one sticker over [inLabel] → [outLabel] (frame w × h, OUTPUT time windows). */
export function stickerGraph(o: StickerOverlay, wins: Array<{ start: number; end: number }>, inputIdx: number, inLabel: string, outLabel: string, w: number, h: number): string[] {
  const k = `st${outLabel}`
  const pw = Math.max(2, Math.round((w * Math.min(1, Math.max(0.02, o.w))) / 2) * 2)
  const s = wins[0]?.start ?? 0
  const e = wins[wins.length - 1]?.end ?? s
  const scale =
    o.anim === 'pop'
      ? `scale=w='max(2,trunc(${pw}*min(1,0.35+0.65*max(0,t-${s.toFixed(3)})/0.25)/2)*2)':h=-2:eval=frame`
      : `scale=${pw}:-2`
  const fade = o.anim === 'fade' && wins.length === 1 ? `,fade=t=in:st=${s.toFixed(3)}:d=0.3:alpha=1,fade=t=out:st=${Math.max(s, e - 0.3).toFixed(3)}:d=0.3:alpha=1` : ''
  const float = o.anim === 'float' ? `+sin(2*PI*t/2.4)*H*0.012` : ''
  return [
    `[${inputIdx}:v]format=rgba,${scale},colorchannelmixer=aa=${Math.min(1, Math.max(0, o.opacity)).toFixed(3)}${fade}[${k}]`,
    `[${inLabel}][${k}]overlay=x='${o.x.toFixed(4)}*W-w/2':y='${o.y.toFixed(4)}*H-h/2${float}':enable='${windowsExpr(wins)}':format=auto:shortest=1:eval=frame[${outLabel}]`
  ]
}
