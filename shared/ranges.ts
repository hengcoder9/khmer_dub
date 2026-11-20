// Edit-list math for the AI video editor (pure, unit tested).
// Source time = position in the original video. Output time = position in the edited export.

import type { Aspect, Clip, EditState, Range } from './types'
import type { Cue } from './srt'

export const MIN_CLIP = 0.08
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Sort and merge overlapping/touching ranges. */
export function normalize(ranges: Range[], eps = 0.001): Range[] {
  const s = ranges.filter((r) => r.end - r.start > eps).sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of s) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + eps) last.end = Math.max(last.end, r.end)
    else out.push({ start: r.start, end: r.end })
  }
  return out
}

/** Pieces of `r` that are not covered by `removed`. */
export function subtract(r: Range, removed: Range[]): Range[] {
  let pieces: Range[] = [{ start: r.start, end: r.end }]
  for (const x of normalize(removed)) {
    const next: Range[] = []
    for (const p of pieces) {
      if (x.end <= p.start || x.start >= p.end) next.push(p)
      else {
        if (x.start > p.start) next.push({ start: p.start, end: x.start })
        if (x.end < p.end) next.push({ start: x.end, end: p.end })
      }
    }
    pieces = next
  }
  return pieces.filter((p) => p.end - p.start >= MIN_CLIP)
}

export const addRemoved = (removed: Range[], r: Range) => normalize([...removed, r])

/** Un-remove a range (e.g. restoring a cut line). */
export function restoreRange(removed: Range[], r: Range): Range[] {
  const out: Range[] = []
  for (const x of normalize(removed)) {
    if (x.end <= r.start || x.start >= r.end) out.push(x)
    else {
      if (x.start < r.start) out.push({ start: x.start, end: r.start })
      if (x.end > r.end) out.push({ start: r.end, end: x.end })
    }
  }
  return out
}

/** True when `r` is (almost) fully removed. */
export function isRemoved(removed: Range[], r: Range): boolean {
  const left = subtract(r, removed).reduce((a, p) => a + p.end - p.start, 0)
  return left < Math.max(MIN_CLIP, (r.end - r.start) * 0.1)
}

/** Default base clip list = the whole video. */
export const fullClip = (duration: number, id = 'c0'): Clip[] => [{ id, start: 0, end: r3(duration) }]

/** One piece of a base clip; pieces keep the clip's speed/volume/color, only the last keeps its transition. */
function pieceOf(c: Clip, p: Range, i: number, last: boolean): Clip {
  const { transition, ...rest } = c
  return { ...rest, id: i === 0 ? c.id : `${c.id}.${i}`, start: r3(p.start), end: r3(p.end), ...(last && transition ? { transition } : {}) }
}

/** Final clips in output order after subtracting removed ranges. */
export function effectiveClips(edit: Pick<EditState, 'clips' | 'removed'>): Clip[] {
  const out: Clip[] = []
  for (const c of edit.clips) {
    const pieces = subtract(c, edit.removed)
    pieces.forEach((p, i) => out.push(pieceOf(c, p, i, i === pieces.length - 1)))
  }
  return out
}

/**
 * Split every base clip at the start of each of its kept pieces, so every timeline clip is its own base clip
 * (needed before moving/trimming/styling one piece). Removed gaps stay inside the clip before them, so a cut can
 * still be restored, and piece ids from effectiveClips() stay the same.
 */
export function explodeClips(edit: Pick<EditState, 'clips' | 'removed'>): Clip[] {
  return edit.clips.flatMap((c) => {
    const pieces = subtract(c, edit.removed)
    if (pieces.length <= 1) return [c]
    return pieces.map((p, i) => {
      const last = i === pieces.length - 1
      return pieceOf(c, { start: i === 0 ? c.start : p.start, end: last ? c.end : pieces[i + 1].start }, i, last)
    })
  })
}

/** Plain source length of ranges (no speed). */
export const totalDuration = (clips: Range[]) => r3(clips.reduce((a, c) => a + (c.end - c.start), 0))

type TClip = Range & Partial<Pick<Clip, 'speed' | 'transition'>>
export const MIN_SPEED = 0.25
export const MAX_SPEED = 4
export const clipSpeed = (c: TClip) => Math.max(MIN_SPEED, Math.min(MAX_SPEED, c.speed || 1))
const outLen = (c: TClip) => (c.end - c.start) / clipSpeed(c)

/** Real length of the transition from clip i into clip i+1 (0 = hard cut); never more than half of either clip. */
export function transitionDur(clips: TClip[], i: number): number {
  const tr = clips[i]?.transition
  if (!tr || i >= clips.length - 1) return 0
  const d = r3(Math.min(tr.duration, outLen(clips[i]) / 2, outLen(clips[i + 1]) / 2))
  return d >= 0.05 ? d : 0
}

export interface Placed<C extends TClip = TClip> {
  clip: C
  /** where the clip starts in the output (a transition overlaps it with the previous clip) */
  outStart: number
  outLen: number
}

/** Position of every clip on the output timeline, after speed changes and transition overlaps. */
export function layoutClips<C extends TClip>(clips: C[]): Placed<C>[] {
  const out: Placed<C>[] = []
  let pos = 0
  clips.forEach((c, i) => {
    const len = outLen(c)
    out.push({ clip: c, outStart: r3(pos), outLen: r3(len) })
    pos += len - transitionDur(clips, i)
  })
  return out
}

/** Length of the edited output. */
export function outputDuration(clips: TClip[]): number {
  const l = layoutClips(clips)
  const last = l[l.length - 1]
  return last ? r3(last.outStart + last.outLen) : 0
}

/** Map a source time to output time, or null when that moment is cut. */
export function sourceToOutput(t: number, clips: TClip[]): number | null {
  for (const p of layoutClips(clips)) {
    if (t >= p.clip.start && t < p.clip.end) return r3(p.outStart + (t - p.clip.start) / clipSpeed(p.clip))
  }
  return null
}

/** Map an output time back to source time (inside a transition, the incoming clip wins). */
export function outputToSource(t: number, clips: TClip[]): number | null {
  let hit: number | null = null
  for (const p of layoutClips(clips)) {
    if (t >= p.outStart && t < p.outStart + p.outLen) hit = r3(p.clip.start + (t - p.outStart) * clipSpeed(p.clip))
  }
  return hit
}

/** Output span of a source range: its first kept piece, or null when it is fully cut. */
export function rangeToOutput(r: Range, placed: Placed[]): (Range & { speed: number }) | null {
  for (const p of placed) {
    const s = Math.max(r.start, p.clip.start)
    const e = Math.min(r.end, p.clip.end)
    if (e > s) {
      const sp = clipSpeed(p.clip)
      return { start: p.outStart + (s - p.clip.start) / sp, end: p.outStart + (e - p.clip.start) / sp, speed: sp }
    }
  }
  return null
}

/** Re-time subtitle cues onto the edited output timeline (a cue spanning a cut is split; clip speed applies). */
export function mapCuesToOutput<T extends Cue>(cues: T[], clips: TClip[]): T[] {
  const out: T[] = []
  for (const p of layoutClips(clips)) {
    const c = p.clip
    const sp = clipSpeed(c)
    for (const q of cues) {
      const s = Math.max(q.start, c.start)
      const e = Math.min(q.end, c.end)
      if ((e - s) / sp >= 0.2) out.push({ ...q, start: r3(p.outStart + (s - c.start) / sp), end: r3(p.outStart + (e - c.start) / sp) })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Split the base clip containing source time t into two (both keep its settings; the transition moves to the second). */
export function splitClipAt(clips: Clip[], t: number, newId: string): Clip[] {
  const i = clips.findIndex((c) => t > c.start + MIN_CLIP && t < c.end - MIN_CLIP)
  if (i < 0) return clips
  const { transition, ...c } = clips[i]
  return [
    ...clips.slice(0, i),
    { ...c, end: r3(t) },
    { ...c, id: newId, start: r3(t), end: clips[i].end, ...(transition ? { transition } : {}) },
    ...clips.slice(i + 1)
  ]
}

/**
 * Drag a clip edge to a new source time. Shrinking cuts the trimmed part out (like Q/W); growing restores cut material
 * and widens the clip when needed. `clips` must already be exploded so the piece id is a base clip id.
 */
export function trimClipEdge(edit: Pick<EditState, 'clips' | 'removed'>, id: string, edge: 'l' | 'r', to: number, duration: number) {
  const piece = effectiveClips(edit).find((c) => c.id === id)
  const i = edit.clips.findIndex((c) => c.id === id)
  if (!piece || i < 0) return edit
  const base = edit.clips[i]
  let clips = edit.clips
  let removed = edit.removed
  if (edge === 'l') {
    const t = r3(Math.max(0, Math.min(piece.end - MIN_CLIP * 2, to)))
    if (t > piece.start) removed = addRemoved(removed, { start: piece.start, end: t })
    else if (t < piece.start) {
      removed = restoreRange(removed, { start: t, end: piece.start })
      if (t < base.start) clips = clips.map((c, k) => (k === i ? { ...c, start: t } : c))
    }
  } else {
    const t = r3(Math.min(duration, Math.max(piece.start + MIN_CLIP * 2, to)))
    if (t < piece.end) removed = addRemoved(removed, { start: t, end: piece.end })
    else if (t > piece.end) {
      removed = restoreRange(removed, { start: piece.end, end: t })
      if (t > base.end) clips = clips.map((c, k) => (k === i ? { ...c, end: t } : c))
    }
  }
  return { clips, removed }
}

export function moveClip(clips: Clip[], from: number, to: number): Clip[] {
  const out = [...clips]
  const [c] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, c)
  return out
}

/** Pad removed ranges inward so cuts keep a little breathing room (used for silence removal). */
export function shrinkRanges(ranges: Range[], pad: number, minLen: number): Range[] {
  return ranges
    .map((r) => ({ start: r3(r.start + pad), end: r3(r.end - pad) }))
    .filter((r) => r.end - r.start >= minLen)
}

// ───────── auto original sound ─────────

/** Where dub lines speak (source time), merged so short gaps don't make the original sound flicker on and off. */
/** Auto original: fade length at each dub edge, and gaps shorter than this stay muted (no on/off flicker). */
export const AUTO_FADE = 0.3
export const AUTO_GAP = 0.8

export function dubSpans(lines: Array<{ start: number; dur: number }>, mergeGap = AUTO_GAP): Range[] {
  const sorted = lines.filter((l) => l.dur > 0).map((l) => ({ start: r3(l.start), end: r3(l.start + l.dur) })).sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + mergeGap) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/** ffmpeg expression: 1 while a dub line speaks, 0 in the gaps, with a short linear fade (seconds) at each edge. */
export function dubOnExpr(spans: Range[], fade = AUTO_FADE): string {
  if (!spans.length) return '0'
  const f = fade.toFixed(3)
  let terms = spans.map((r) => `clip((t-${(r.start - fade).toFixed(3)})/${f},0,1)*clip((${(r.end + fade).toFixed(3)}-t)/${f},0,1)`)
  // ffmpeg's expression parser fails on long flat sums (~100 terms): nest them in groups of 20
  while (terms.length > 20) {
    const groups: string[] = []
    for (let i = 0; i < terms.length; i += 20) groups.push(`(${terms.slice(i, i + 20).join('+')})`)
    terms = groups
  }
  return `min(1,${terms.join('+')})`
}

/** Same curve as dubOnExpr, in JS for the preview: 1 under a dub line, 0 in the gaps, linear fade at the edges. */
export function dubOnAt(spans: Range[], t: number, fade = AUTO_FADE): number {
  const c = (x: number) => Math.max(0, Math.min(1, x))
  let k = 0
  for (const r of spans) {
    if (t < r.start - fade) break
    if (t <= r.end + fade) k += c((t - (r.start - fade)) / fade) * c((r.end + fade - t) / fade)
  }
  return Math.min(1, k)
}

// ───────── export size ─────────

/** Export resolutions by their short side ("1080p" = 1920×1080 landscape, 1080×1920 vertical). 0 = keep the source. */
export const RESOLUTIONS = [0, 720, 1080, 1440, 2160] as const

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Pixel size of the export for a format (aspect) and an optional resolution (short side in px). */
export function outputSize(aspect: Aspect, w: number, h: number, res?: number): { w: number; h: number } {
  if (aspect === 'source' || !w || !h) {
    if (!res || !w || !h) return { w: even(w || 1280), h: even(h || 720) }
    const k = res / Math.min(w, h)
    return { w: even(w * k), h: even(h * k) }
  }
  const short = res || Math.min(1080, Math.max(720, Math.min(w, h)))
  const [aw, ah] = aspect.split(':').map(Number)
  return aw >= ah ? { w: even((short * aw) / ah), h: even(short) } : { w: even(short), h: even((short * ah) / aw) }
}
