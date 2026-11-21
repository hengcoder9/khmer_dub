// Split one exported video into parts ("EP01, EP02…") of a fixed length (pure, unit tested).
import type { Cue } from './srt'

/** Part lengths offered in Export (minutes); 0 = one full video. */
export const SPLIT_MINUTES = [0, 3, 5, 10, 15, 20, 30] as const

/** Cuts snap to a gap between subtitle lines within this many seconds of the target, so no line is cut in half. */
const SNAP_SEC = 20

const inside = (t: number, cues: Cue[]) => cues.some((c) => t > c.start + 0.01 && t < c.end - 0.01)

/**
 * Cut times (seconds, ascending, excluding 0 and the end) for parts of `partSec`.
 * A last part shorter than a quarter of `partSec` is merged into the one before it.
 */
export function planParts(durationSec: number, partSec: number, cues: Cue[] = []): number[] {
  if (!(partSec > 0) || durationSec <= partSec * 1.25) return []
  const cuts: number[] = []
  let prev = 0
  for (;;) {
    const target = prev + partSec
    if (durationSec - target < partSec * 0.25) break
    let cut = target
    if (inside(target, cues)) {
      const candidates = cues
        .flatMap((c) => [c.start, c.end])
        .filter((t) => Math.abs(t - target) <= SNAP_SEC && t > prev + partSec * 0.5 && t < durationSec - 1 && !inside(t, cues))
      if (candidates.length) cut = candidates.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a))
    }
    cuts.push(Math.round(cut * 1000) / 1000)
    prev = cut
  }
  return cuts
}

/** [start, end] of every part from the cut times. */
export function partRanges(durationSec: number, cuts: number[]): Array<{ start: number; end: number }> {
  const edges = [0, ...cuts, durationSec]
  return edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1] }))
}

/** The lines of one part, re-timed to start at 0 (a line crossing a cut is clipped to the part). */
export function cuesForPart(cues: Cue[], start: number, end: number): Cue[] {
  return cues
    .filter((c) => c.end > start + 0.05 && c.start < end - 0.05)
    .map((c) => ({ ...c, start: Math.max(0, c.start - start), end: Math.min(end, c.end) - start }))
}

/** "Name EP01" … zero-padded to the number of parts. */
export function partName(base: string, index: number, count: number): string {
  return `${base} EP${String(index + 1).padStart(Math.max(2, String(count).length), '0')}`
}
