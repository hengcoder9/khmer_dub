// Ads inside the exported video (pure, unit tested):
//   • video ads — whole clips played at the start, at the end, or every N minutes ("pre / post / mid-roll").
//     When the export is split into episodes, every part gets its own ads.
//   • banner ads — an image over the picture, always or for a few seconds every N minutes.
// The main video keeps its own timeline ("main time"); ads push everything after them later ("final time").
import type { Cue } from './srt'
import type { AdBanner, AdVideo, AdsSettings } from './types'

/** Mid-rolls closer than this to the end of a part are skipped (the post-roll / next part is about to start). */
const MID_TAIL_SEC = 15

export type AdPiece =
  | { kind: 'main'; from: number; to: number; at: number }
  | { kind: 'ad'; ad: number; dur: number; at: number }

export interface AdPlan {
  pieces: AdPiece[]
  /** final length with the ads */
  total: number
  /** final-time cut points between the parts (empty when not splitting) */
  cuts: number[]
}

export const videoAdsOn = (a?: AdsSettings): AdVideo[] => (a?.videos ?? []).filter((v) => v.enabled && v.path && (v.durationSec ?? 0) > 0.1)
export const bannersOn = (a?: AdsSettings): AdBanner[] => (a?.banners ?? []).filter((b) => b.enabled && b.path)
export const adsOn = (a?: AdsSettings) => videoAdsOn(a).length > 0 || bannersOn(a).length > 0

const r3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * Lay the video ads into the main timeline. `parts` are main-time ranges (one range when not splitting);
 * `ads` are the enabled video ads with their length. Ad indexes refer to `ads`.
 */
export function planAds(parts: Array<{ start: number; end: number }>, ads: AdVideo[]): AdPlan {
  const pieces: AdPiece[] = []
  const cuts: number[] = []
  let at = 0
  const pushAd = (i: number) => {
    const dur = Math.max(0, ads[i].durationSec ?? 0)
    if (dur <= 0.05) return
    pieces.push({ kind: 'ad', ad: i, dur, at: r3(at) })
    at += dur
  }
  const pushMain = (from: number, to: number) => {
    if (to - from <= 0.001) return
    pieces.push({ kind: 'main', from: r3(from), to: r3(to), at: r3(at) })
    at += to - from
  }
  parts.forEach((part, pi) => {
    if (pi > 0) cuts.push(r3(at))
    ads.forEach((a, i) => a.at === 'start' && pushAd(i))
    // mid-rolls: every N minutes counted from the start of this part
    const stops = new Map<number, number[]>()
    ads.forEach((a, i) => {
      if (a.at !== 'every' || !((a.everyMin ?? 0) > 0)) return
      const step = a.everyMin! * 60
      for (let t = part.start + step; t < part.end - MID_TAIL_SEC; t += step) {
        const k = r3(t)
        stops.set(k, [...(stops.get(k) ?? []), i])
      }
    })
    let from = part.start
    for (const t of [...stops.keys()].sort((x, y) => x - y)) {
      pushMain(from, t)
      stops.get(t)!.forEach(pushAd)
      from = t
    }
    pushMain(from, part.end)
    ads.forEach((a, i) => a.at === 'end' && pushAd(i))
  })
  return { pieces, total: r3(at), cuts }
}

/** Main time → final time (a time on an ad boundary goes to the main piece that starts there). */
export function mapMainTime(plan: AdPlan, t: number): number {
  const mains = plan.pieces.filter((p): p is Extract<AdPiece, { kind: 'main' }> => p.kind === 'main')
  if (!mains.length) return t
  const hit = mains.find((p) => t >= p.from - 1e-6 && t < p.to - 1e-6) ?? (t >= mains[mains.length - 1].to - 1e-6 ? mains[mains.length - 1] : mains[0])
  return r3(hit.at + (Math.min(Math.max(t, hit.from), hit.to) - hit.from))
}

/** Subtitle lines moved to final time; a line that runs into an ad break stops where the break starts. */
export function mapCuesThroughAds(cues: Cue[], plan: AdPlan): Cue[] {
  if (!plan.pieces.some((p) => p.kind === 'ad')) return cues
  const mains = plan.pieces.filter((p): p is Extract<AdPiece, { kind: 'main' }> => p.kind === 'main')
  return cues.map((c) => {
    const start = mapMainTime(plan, c.start)
    const piece = mains.find((p) => c.start >= p.from - 1e-6 && c.start < p.to - 1e-6)
    const endLimit = piece ? piece.at + (piece.to - piece.from) : Infinity
    return { ...c, start, end: r3(Math.min(mapMainTime(plan, c.end), endLimit, start + (c.end - c.start))) }
  })
}

/** ffmpeg `enable=` expression for a banner (t = main-video time). */
export function bannerEnable(b: AdBanner): string | null {
  if (b.show !== 'interval') return null
  const every = Math.max(10, (b.everyMin || 1) * 60)
  const forSec = Math.min(every, Math.max(1, b.forSec || 10))
  const first = Math.max(0, b.startSec ?? 0)
  return `gte(t,${first})*lt(mod(t-${first},${every}),${forSec})`
}

/** Is the banner on screen at main time t (for the preview)? */
export function bannerVisible(b: AdBanner, t: number): boolean {
  if (b.show !== 'interval') return true
  const every = Math.max(10, (b.everyMin || 1) * 60)
  const forSec = Math.min(every, Math.max(1, b.forSec || 10))
  const first = Math.max(0, b.startSec ?? 0)
  return t >= first && (t - first) % every < forSec
}

/** ffmpeg overlay x:y for a banner (m = margin in px). */
export function bannerXY(pos: AdBanner['position'], m: number): string {
  return {
    top: `(W-w)/2:${m}`,
    bottom: `(W-w)/2:H-h-${m}`,
    center: '(W-w)/2:(H-h)/2',
    tl: `${m}:${m}`,
    tr: `W-w-${m}:${m}`,
    bl: `${m}:H-h-${m}`,
    br: `W-w-${m}:H-h-${m}`
  }[pos]
}
