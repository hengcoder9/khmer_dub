// Edit-list math for the AI video editor (pure, unit tested).
// Source time = position in the original video. Output time = position in the edited export.

import type { Clip, EditState, Range } from './types'
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

/** Final clips in output order after subtracting removed ranges. */
export function effectiveClips(edit: Pick<EditState, 'clips' | 'removed'>): Clip[] {
  const out: Clip[] = []
  for (const c of edit.clips) {
    subtract(c, edit.removed).forEach((p, i) => out.push({ id: i === 0 ? c.id : `${c.id}.${i}`, start: r3(p.start), end: r3(p.end) }))
  }
  return out
}

export const totalDuration = (clips: Range[]) => r3(clips.reduce((a, c) => a + (c.end - c.start), 0))

/** Map a source time to output time, or null when that moment is cut. */
export function sourceToOutput(t: number, clips: Range[]): number | null {
  let acc = 0
  for (const c of clips) {
    if (t >= c.start && t < c.end) return r3(acc + (t - c.start))
    acc += c.end - c.start
  }
  return null
}

/** Map an output time back to source time. */
export function outputToSource(t: number, clips: Range[]): number | null {
  let acc = 0
  for (const c of clips) {
    const len = c.end - c.start
    if (t < acc + len) return r3(c.start + (t - acc))
    acc += len
  }
  return null
}

/** Re-time subtitle cues onto the edited output timeline (a cue spanning a cut is split). */
export function mapCuesToOutput<T extends Cue>(cues: T[], clips: Range[]): T[] {
  const out: T[] = []
  let acc = 0
  for (const c of clips) {
    for (const q of cues) {
      const s = Math.max(q.start, c.start)
      const e = Math.min(q.end, c.end)
      if (e - s >= 0.2) out.push({ ...q, start: r3(acc + s - c.start), end: r3(acc + e - c.start) })
    }
    acc += c.end - c.start
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Split the base clip containing source time t into two clips. */
export function splitClipAt(clips: Clip[], t: number, newId: string): Clip[] {
  const i = clips.findIndex((c) => t > c.start + MIN_CLIP && t < c.end - MIN_CLIP)
  if (i < 0) return clips
  const c = clips[i]
  return [...clips.slice(0, i), { ...c, end: r3(t) }, { id: newId, start: r3(t), end: c.end }, ...clips.slice(i + 1)]
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
