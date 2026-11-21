// Styled captions â†’ ASS (Advanced SubStation Alpha) for libass burn-in (pure, unit tested).

import type { CaptionStyle } from './types'
import type { Cue } from './srt'

export const CAPTION_PRESETS: Record<string, Partial<CaptionStyle>> = {
  classic: { font: 'Kantumruy Pro', size: 46, primary: '#FFFFFF', highlight: '#FFD400', outlineColor: '#000000', outline: 3, shadow: 1, bold: false, box: false, position: 'bottom', mode: 'line' },
  boldYellow: { size: 54, primary: '#FFE000', highlight: '#FFFFFF', outlineColor: '#000000', outline: 4, shadow: 2, bold: true, box: false, position: 'bottom', mode: 'line' },
  karaoke: { size: 56, primary: '#FFFFFF', highlight: '#00E5A0', outlineColor: '#000000', outline: 4, shadow: 1, bold: true, box: false, position: 'middle', mode: 'karaoke' },
  wordPop: { size: 72, primary: '#FFFFFF', highlight: '#FFD400', outlineColor: '#000000', outline: 5, shadow: 0, bold: true, box: false, position: 'middle', mode: 'word' },
  boxed: { size: 44, primary: '#FFFFFF', highlight: '#FFD400', outlineColor: '#000000', outline: 0, shadow: 0, bold: false, box: true, boxColor: '#000000', position: 'bottom', mode: 'line' },
  minimal: { size: 38, primary: '#F2F2F2', highlight: '#FFFFFF', outlineColor: '#000000', outline: 1.5, shadow: 0, bold: false, box: false, position: 'bottom', mode: 'line' }
}

export const DEFAULT_CAPTIONS: CaptionStyle = {
  preset: 'classic',
  font: 'Kantumruy Pro',
  size: 46,
  primary: '#FFFFFF',
  highlight: '#FFD400',
  outlineColor: '#000000',
  outline: 3,
  shadow: 1,
  bold: false,
  box: false,
  boxColor: '#000000',
  position: 'bottom',
  marginV: 60,
  mode: 'line',
  source: 'target'
}

/** #RRGGBB (+ alpha 0..1 opacity) â†’ ASS &HAABBGGRR */
export function assColor(hex: string, opacity = 1): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const rgb = m ? m[1] : 'FFFFFF'
  const [r, g, b] = [rgb.slice(0, 2), rgb.slice(2, 4), rgb.slice(4, 6)]
  const a = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)
    .toString(16)
    .padStart(2, '0')
  return `&H${a}${b}${g}${r}`.toUpperCase()
}

export function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor(cs / 6000) % 60
  const s = Math.floor(cs / 100) % 60
  const c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

const escapeText = (t: string) => t.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N')

/** Split text into display tokens; Khmer has no spaces, so use ICU word segmentation. */
export function tokenize(text: string, lang = 'km'): string[] {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (!Seg) return text.split(/(\s+)/).filter(Boolean)
  const seg = new Seg(lang, { granularity: 'word' })
  const tokens: string[] = []
  for (const s of seg.segment(text)) {
    // glue whitespace and punctuation onto the previous token so highlights don't flash on blanks
    if (!s.isWordLike && tokens.length) tokens[tokens.length - 1] += s.segment
    else tokens.push(s.segment)
  }
  return tokens.filter((t) => t.length > 0)
}

/** Distribute a cue's duration over tokens proportionally to their length. */
export function tokenTimings(tokens: string[], start: number, end: number): Array<{ text: string; start: number; end: number }> {
  const weights = tokens.map((t) => Math.max(1, t.trim().length))
  const total = weights.reduce((a, b) => a + b, 0)
  let t = start
  return tokens.map((text, i) => {
    const d = ((end - start) * weights[i]) / total
    const item = { text, start: t, end: t + d }
    t += d
    return item
  })
}

export function toAss(cues: Cue[], style: CaptionStyle, width: number, height: number, lang = 'km'): string {
  const align = style.position === 'top' ? 8 : style.position === 'middle' ? 5 : 2
  const scale = height / 1080 // style sizes are authored for 1080p
  const size = Math.round(style.size * scale)
  const outline = +(style.outline * scale).toFixed(1)
  const shadow = +(style.shadow * scale).toFixed(1)
  const marginV = Math.round(style.marginV * scale)
  const borderStyle = style.box ? 3 : 1
  const outlineCol = style.box ? assColor(style.boxColor, 0.75) : assColor(style.outlineColor)
  const backCol = style.box ? assColor(style.boxColor, 0.75) : assColor('#000000', 0.5)
  // karaoke: Secondary = not yet sung, Primary = sung (highlight)
  const primary = style.mode === 'karaoke' ? assColor(style.highlight) : assColor(style.primary)
  const secondary = style.mode === 'karaoke' ? assColor(style.primary) : assColor(style.highlight)

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${style.font},${size},${primary},${secondary},${outlineCol},${backCol},${style.bold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${align},${Math.round(60 * scale)},${Math.round(60 * scale)},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]

  const events: string[] = []
  const dlg = (s: number, e: number, text: string) => events.push(`Dialogue: 0,${assTime(s)},${assTime(e)},Default,,0,0,0,,${text}`)

  for (const c of cues) {
    const text = c.text.trim()
    if (!text || c.end <= c.start) continue
    if (style.mode === 'line') {
      dlg(c.start, c.end, escapeText(text))
    } else if (style.mode === 'karaoke') {
      const parts = tokenTimings(tokenize(text, lang), c.start, c.end)
      dlg(c.start, c.end, parts.map((p) => `{\\kf${Math.max(1, Math.round((p.end - p.start) * 100))}}${escapeText(p.text)}`).join(''))
    } else {
      // word pop: one token at a time, slight scale bounce, in highlight color
      const parts = tokenTimings(tokenize(text, lang), c.start, c.end)
      for (const p of parts) {
        const w = escapeText(p.text.trim())
        if (w) dlg(p.start, p.end, `{\\c${assColor(style.highlight)}\\fscx115\\fscy115\\t(0,90,\\fscx100\\fscy100)}${w}`)
      }
    }
  }
  return header.join('\n') + '\n' + events.join('\n') + '\n'
}

/**
 * AI Creator hook: a big boxed title at the top for the first seconds of a short (rendered by libass like the
 * captions, so Khmer shapes correctly). Adds a "Hook" style and one event to an ASS file made by toAss().
 */
/**
 * Claude Video: a big title per scene in the upper third (bold, outlined, pops in), added to an ASS file from toAss().
 */
export function withTitles(ass: string, titles: Array<{ text: string; start: number; end: number }>, font: string, width: number, height: number): string {
  const list = titles.map((x) => ({ ...x, text: escapeText(x.text.trim()) })).filter((x) => x.text && x.end > x.start)
  if (!list.length) return ass
  const short = Math.min(width, height)
  const size = Math.round(short * 0.125)
  const style = `Style: Title,${font},${size},${assColor('#FFFFFF')},${assColor('#FFFFFF')},${assColor('#000000')},${assColor('#000000', 0.55)},-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(size * 0.08))},${Math.max(1, Math.round(size * 0.06))},8,${Math.round(width * 0.08)},${Math.round(width * 0.08)},${Math.round(height * 0.22)},1`
  const events = list.map(
    (x) => `Dialogue: 1,${assTime(x.start)},${assTime(x.end)},Title,,0,0,0,,{\\fad(250,250)\\fscx80\\fscy80\\t(0,250,\\fscx100\\fscy100)}${x.text}`
  )
  const lines = ass.split('\n')
  const at = lines.findIndex((l) => l.startsWith('Style: '))
  lines.splice(at >= 0 ? at + 1 : lines.length, 0, style)
  return lines.join('\n').replace(/\n*$/, '\n') + events.join('\n') + '\n'
}

export function withHook(ass: string, hook: string, font: string, width: number, height: number, seconds = 3): string {
  const text = escapeText(hook.trim())
  if (!text) return ass
  const short = Math.min(width, height)
  const size = Math.round(short * 0.075)
  const style = `Style: Hook,${font},${size},${assColor('#FFFFFF')},${assColor('#FFFFFF')},${assColor('#000000', 0.7)},${assColor('#000000', 0.7)},-1,0,0,0,100,100,0,0,3,${Math.max(2, Math.round(size * 0.18))},0,8,${Math.round(width * 0.07)},${Math.round(width * 0.07)},${Math.round(height * 0.1)},1`
  const event = `Dialogue: 1,${assTime(0)},${assTime(seconds)},Hook,,0,0,0,,{\\fad(150,350)}${text}`
  const lines = ass.split('\n')
  const at = lines.findIndex((l) => l.startsWith('Style: '))
  lines.splice(at >= 0 ? at + 1 : lines.length, 0, style)
  return lines.join('\n').replace(/\n*$/, '\n') + event + '\n'
}
