// "Hide old subtitles": blur (or cover with a bar) the source video's burned-in subtitles (pure, unit tested).
// The area is in fractions of the SOURCE frame, so it is applied before cutting / reframing and follows every edit.
import type { SubCover } from './types'

export const SUBCOVER_DEFAULT: SubCover = { enabled: true, x: 0.06, y: 0.77, w: 0.88, h: 0.19, mode: 'blur', strength: 2, color: '#000000', opacity: 0.85 }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const f = (v: number) => v.toFixed(4)

/** Keep the rectangle inside the frame and at least 2 % tall / wide. */
export function normCover(c: SubCover): SubCover {
  const w = clamp(c.w, 0.02, 1)
  const h = clamp(c.h, 0.02, 1)
  return { ...c, w, h, x: clamp(c.x, 0, 1 - w), y: clamp(c.y, 0, 1 - h), strength: clamp(Math.round(c.strength ?? 2), 1, 3), opacity: clamp(c.opacity ?? 0.85, 0.1, 1) }
}

export const coverOn = (c?: SubCover | null): c is SubCover => !!c && c.enabled && c.w > 0 && c.h > 0

/** Blur radius in px for a source frame of this height (strength 1/2/3 ≈ 1.2 / 2.4 / 3.6 % of the height). */
export const coverRadius = (c: SubCover, srcHeight: number) => Math.max(3, Math.round(Math.max(120, srcHeight || 720) * 0.012 * (c.strength ?? 2)))

/**
 * ffmpeg filter-graph lines that read [inLabel] and write [outLabel].
 * blur: crop the area → boxblur (radius capped to the crop size; quoted because of the comma) → overlay back in place.
 * box:  drawbox filled with the chosen colour / opacity.
 */
export function coverGraph(cover: SubCover, inLabel: string, outLabel: string, srcHeight: number): string[] {
  const c = normCover(cover)
  if (c.mode === 'box') {
    const col = /^#?[0-9a-f]{6}$/i.test(c.color ?? '') ? '0x' + c.color!.replace('#', '').toUpperCase() : '0x000000'
    return [`[${inLabel}]drawbox=x=iw*${f(c.x)}:y=ih*${f(c.y)}:w=iw*${f(c.w)}:h=ih*${f(c.h)}:color=${col}@${c.opacity!.toFixed(2)}:t=fill[${outLabel}]`]
  }
  const r = coverRadius(c, srcHeight)
  return [
    `[${inLabel}]split=2[scm][scs]`,
    `[scs]crop=w=iw*${f(c.w)}:h=ih*${f(c.h)}:x=iw*${f(c.x)}:y=ih*${f(c.y)},boxblur=luma_radius='min(h/2-1,${r})':luma_power=2:chroma_radius='min(ch/2-1,${Math.max(2, Math.round(r / 2))})':chroma_power=2[scb]`,
    `[scm][scb]overlay=x=W*${f(c.x)}:y=H*${f(c.y)}[${outLabel}]`
  ]
}

/**
 * Where the SOURCE picture sits inside a player box of aspect `boxAspect` (percent of the box):
 * contain = letterboxed / blurred-background fit, cover = cropped to fill.
 */
export function sourceRect(srcAspect: number, boxAspect: number, fit: 'contain' | 'cover'): { left: number; top: number; width: number; height: number } {
  const wide = srcAspect >= boxAspect
  if (fit === 'contain') {
    if (wide) {
      const h = (boxAspect / srcAspect) * 100
      return { left: 0, top: (100 - h) / 2, width: 100, height: h }
    }
    const w = (srcAspect / boxAspect) * 100
    return { left: (100 - w) / 2, top: 0, width: w, height: 100 }
  }
  if (wide) {
    const w = (srcAspect / boxAspect) * 100
    return { left: (100 - w) / 2, top: 0, width: w, height: 100 }
  }
  const h = (boxAspect / srcAspect) * 100
  return { left: 0, top: (100 - h) / 2, width: 100, height: h }
}
