// Post-processing of transcription output (pure, unit tested).

import type { Word } from './types'

export interface RawSeg {
  start: number
  end: number
  text: string
  speaker?: string
  gender?: string
  translated?: string
  words?: Word[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Merge segments shorter than minDur into a neighbour (prefer the closer one, same speaker). */
export function mergeShort(segs: RawSeg[], minDur = 0.6): RawSeg[] {
  const out = segs.map((s) => ({ ...s }))
  let i = 0
  while (i < out.length) {
    const s = out[i]
    if (s.end - s.start >= minDur || out.length === 1) {
      i++
      continue
    }
    const prev = out[i - 1]
    const next = out[i + 1]
    const gapPrev = prev ? s.start - prev.end : Infinity
    const gapNext = next ? next.start - s.end : Infinity
    const samePrev = prev && prev.speaker === s.speaker
    const sameNext = next && next.speaker === s.speaker
    const usePrev = prev && (gapPrev <= gapNext || !next) && (samePrev || !sameNext)
    const target = usePrev ? prev : next
    if (!target || Math.min(gapPrev, gapNext) > 1.5) {
      i++ // isolated short line: keep it
      continue
    }
    if (target === prev) {
      prev.end = Math.max(prev.end, s.end)
      prev.text = join(prev.text, s.text)
      prev.translated = joinOpt(prev.translated, s.translated)
      prev.words = [...(prev.words ?? []), ...(s.words ?? [])]
    } else {
      next.start = Math.min(next.start, s.start)
      next.text = join(s.text, next.text)
      next.translated = joinOpt(s.translated, next.translated)
      next.words = [...(s.words ?? []), ...(next.words ?? [])]
    }
    out.splice(i, 1)
  }
  return out
}

const join = (a: string, b: string) => `${a.trim()} ${b.trim()}`.trim()
const joinOpt = (a?: string, b?: string) => (a || b ? join(a ?? '', b ?? '') : undefined)

const PUNCT = /[.!?。！？៕។,，;:、]/

/** Split segments longer than maxDur at punctuation (using word timings when available). */
export function splitLong(segs: RawSeg[], maxDur = 8): RawSeg[] {
  const out: RawSeg[] = []
  for (const s of segs) out.push(...splitOne(s, maxDur))
  return out
}

function splitOne(s: RawSeg, maxDur: number): RawSeg[] {
  const dur = s.end - s.start
  if (dur <= maxDur) return [s]
  if (s.words && s.words.length > 1) {
    // choose the punctuation word closest to the middle; fall back to the middle word
    const mid = s.start + dur / 2
    let best = -1
    let bestDist = Infinity
    s.words.forEach((w, i) => {
      if (i === s.words!.length - 1) return
      const d = Math.abs(w.end - mid)
      const punct = PUNCT.test(w.text.trim().slice(-1))
      const score = punct ? d : d + dur // strongly prefer punctuation
      if (score < bestDist) {
        bestDist = score
        best = i
      }
    })
    const a = s.words.slice(0, best + 1)
    const b = s.words.slice(best + 1)
    const left: RawSeg = { ...s, end: r2(a[a.length - 1].end), text: wordsText(a), words: a, translated: undefined }
    const right: RawSeg = { ...s, start: r2(b[0].start), text: wordsText(b), words: b, translated: undefined }
    return [...splitOne(left, maxDur), ...splitOne(right, maxDur)]
  }
  // no word timings: split the text at punctuation nearest the middle, time proportional to characters
  const text = s.text
  const center = text.length / 2
  let cut = -1
  for (let i = 0; i < text.length - 1; i++) {
    if (PUNCT.test(text[i]) && (cut < 0 || Math.abs(i - center) < Math.abs(cut - center))) cut = i
  }
  if (cut < 0) {
    const sp = text.lastIndexOf(' ', Math.floor(center))
    cut = sp > 0 ? sp : -1
  }
  if (cut < 0 || cut >= text.length - 1) return [s]
  const t = s.start + dur * ((cut + 1) / text.length)
  const left = { ...s, end: r2(t), text: text.slice(0, cut + 1).trim(), translated: undefined }
  const right = { ...s, start: r2(t), text: text.slice(cut + 1).trim(), translated: undefined }
  if (!left.text || !right.text) return [s]
  return [...splitOne(left, maxDur), ...splitOne(right, maxDur)]
}

const wordsText = (w: Word[]) => w.map((x) => x.text).join('').replace(/\s+/g, ' ').trim()

/** Ensure segments are sorted and do not overlap (each ends before the next starts). */
export function clampOverlaps(segs: RawSeg[]): RawSeg[] {
  const out = [...segs].sort((a, b) => a.start - b.start).map((s) => ({ ...s }))
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].end > out[i + 1].start) out[i].end = Math.max(out[i].start + 0.05, out[i + 1].start)
  }
  return out.map((s) => ({ ...s, start: r2(s.start), end: r2(s.end) }))
}

export const postProcess = (segs: RawSeg[]) =>
  clampOverlaps(splitLong(mergeShort(clampOverlaps(segs.filter((s) => s.text.trim())))))

/**
 * Plan audio chunks for cloud transcription: ≤ maxSingle seconds → one chunk; otherwise ~target-second
 * chunks cut at the silence nearest each target point, with `overlap` seconds of overlap.
 */
export function planChunks(
  duration: number,
  silences: Array<{ start: number; end: number }>,
  target = 300,
  overlap = 2,
  maxSingle = 600
): Array<{ start: number; end: number }> {
  if (duration <= maxSingle) return [{ start: 0, end: duration }]
  const cuts: number[] = []
  let pos = 0
  while (duration - pos > target * 1.2) {
    const want = pos + target
    const near = silences
      .map((s) => (s.start + s.end) / 2)
      .filter((m) => m > pos + target * 0.6 && m < pos + target * 1.15)
      .sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0]
    const cut = near ?? want
    cuts.push(cut)
    pos = cut
  }
  const bounds = [0, ...cuts, duration]
  return bounds.slice(0, -1).map((s, i) => ({ start: r2(Math.max(0, s - (i ? overlap : 0))), end: r2(bounds[i + 1]) }))
}

/** Remove duplicates produced by overlapping audio chunks: keep the first segment that starts in an overlap zone. */
export function dedupeByTime(segs: RawSeg[], tolerance = 0.6): RawSeg[] {
  const sorted = [...segs].sort((a, b) => a.start - b.start)
  const out: RawSeg[] = []
  for (const s of sorted) {
    const dup = out.find((o) => Math.abs(o.start - s.start) < tolerance && similar(o.text, s.text))
    if (!dup) out.push(s)
  }
  return out
}

function similar(a: string, b: string): boolean {
  const x = a.replace(/\s+/g, '')
  const y = b.replace(/\s+/g, '')
  if (!x || !y) return x === y
  return x.includes(y) || y.includes(x) || x.slice(0, 6) === y.slice(0, 6)
}
