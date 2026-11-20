// "Listen + Read" merge: combine speech recognition (precise timing) with on-screen subtitles (exact words).
// Pure and unit tested.

import type { RawSeg } from './segments'
import type { Word } from './types'

export interface MergedLine {
  start: number
  end: number
  /** words as spoken / shown in the source language */
  original: string
  /** filled when the burned-in subtitles were already Khmer */
  target: string
  source: 'screen' | 'audio' | 'both'
}

export interface MergeResult {
  lines: MergedLine[]
  /** share of speech time covered by on-screen subtitles (0..1) */
  coverage: number
  usedScreen: boolean
  screenIsTarget: boolean
}

const KHMER = /[ក-៿]/g
const LETTERS = /\p{L}/gu
const r2 = (n: number) => Math.round(n * 100) / 100

/** True when most letters in the texts are Khmer script. */
export function isKhmer(texts: string[]): boolean {
  let km = 0
  let all = 0
  for (const t of texts) {
    km += t.match(KHMER)?.length ?? 0
    all += t.match(LETTERS)?.length ?? 0
  }
  return all > 0 && km / all > 0.5
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))

/** Words with timing; segments without word timestamps count as one "word". */
function wordsOf(audio: RawSeg[]): Word[] {
  return audio.flatMap((s) => (s.words?.length ? s.words : [{ start: s.start, end: s.end, text: ` ${s.text}` }])).filter((w) => w.end > w.start)
}

/**
 * @param audio  transcription segments (with word timestamps when available)
 * @param screen subtitle lines read from the frames (timing accurate to ±interval)
 * @param interval seconds between sampled frames
 */
export function mergeListenRead(audio: RawSeg[], screen: RawSeg[], interval: number, minCoverage = 0.3): MergeResult {
  const speech = audio.reduce((n, s) => n + (s.end - s.start), 0)
  const scr = screen.filter((s) => s.text.trim() && s.end > s.start)
  const covered = audio.reduce((n, a) => n + Math.min(a.end - a.start, scr.reduce((m, s) => m + overlap(a, s), 0)), 0)
  const coverage = speech > 0 ? covered / speech : scr.length ? 1 : 0
  const audioOnly = (): MergeResult => ({
    lines: audio.filter((a) => a.text.trim()).map((a) => ({ start: r2(a.start), end: r2(a.end), original: a.text.trim(), target: '', source: 'audio' })),
    coverage,
    usedScreen: false,
    screenIsTarget: false
  })
  if (!scr.length || coverage < minCoverage) return audioOnly()

  const screenIsTarget = isKhmer(scr.map((s) => s.text)) && !isKhmer(audio.map((a) => a.text))
  const words = wordsOf(audio)
  const slack = Math.max(0.25, interval)
  const lines: MergedLine[] = []

  // 1. every on-screen subtitle becomes a line; snap its edges to the speech inside it
  for (const s of scr) {
    const inside = words.filter((w) => w.end > s.start - slack && w.start < s.end + slack && overlap(w, { start: s.start - slack, end: s.end + slack }) >= (w.end - w.start) / 2)
    let start = s.start
    let end = s.end
    if (inside.length) {
      start = inside[0].start
      end = inside[inside.length - 1].end
      // keep the subtitle on screen at least as long as it was visible, but never start before its speech
      end = Math.max(end, Math.min(s.end, start + (s.end - s.start)))
    }
    const spoken = inside.map((w) => w.text).join('').replace(/\s+/g, ' ').trim()
    lines.push({
      start,
      end,
      original: screenIsTarget ? spoken : s.text.trim(),
      target: screenIsTarget ? s.text.trim() : '',
      source: inside.length ? 'both' : 'screen'
    })
  }

  // 2. speech that has no subtitle on screen keeps the audio text
  for (const a of audio) {
    if (!a.text.trim()) continue
    const hit = scr.reduce((m, s) => m + overlap(a, { start: s.start - slack / 2, end: s.end + slack / 2 }), 0)
    if (hit / Math.max(0.01, a.end - a.start) < 0.25) lines.push({ start: a.start, end: a.end, original: a.text.trim(), target: '', source: 'audio' })
  }

  // 3. order and remove overlaps (a line ends where the next one starts)
  lines.sort((x, y) => x.start - y.start)
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].end > lines[i + 1].start) lines[i].end = Math.max(lines[i].start + 0.2, lines[i + 1].start)
    if (lines[i + 1].start < lines[i].end) lines[i + 1].start = lines[i].end
  }
  return {
    lines: lines.filter((l) => l.end > l.start).map((l) => ({ ...l, start: r2(l.start), end: r2(l.end) })),
    coverage,
    usedScreen: true,
    screenIsTarget
  }
}
