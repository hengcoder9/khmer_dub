// Read Screen timing (pure, unit tested):
//   • the AI reads the subtitle text on frames sampled every `interval` seconds;
//   • a fast pixel scan of the subtitle band (≈10 fps) finds the exact frames where text appears, changes or
//     disappears, so every line starts and ends on the real frame (±0.1 s instead of ±interval);
//   • readings of the same line that differ by a letter or two (OCR noise) or blink out for one sample are merged.

export interface Reading {
  t: number
  text: string
}

export interface ReadLine {
  start: number
  end: number
  text: string
  /** sample time of the first / last reading of this line */
  firstT: number
  lastT: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
/** compare only letters and digits (OCR often adds / drops punctuation and spaces) */
const core = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Similarity 0..1 of two readings (1 = same words), Levenshtein on letters and digits. */
export function textSimilarity(a: string, b: string): number {
  const x = [...core(a)]
  const y = [...core(b)]
  if (!x.length && !y.length) return 1
  if (!x.length || !y.length) return 0
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const cur = [i]
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length)
}

/** Readings (sorted by time) → lines. Near-identical readings join; one empty sample inside a line is a blink. */
export function mergeReadings(readings: Reading[], interval: number, same = 0.8): ReadLine[] {
  const rows = [...readings].sort((a, b) => a.t - b.t).map((r) => ({ t: r.t, text: norm(r.text) }))
  const groups: Array<{ texts: string[]; firstT: number; lastT: number }> = []
  for (let i = 0; i < rows.length; i++) {
    const { t, text } = rows[i]
    if (!text) continue
    const g = groups[groups.length - 1]
    const ref = g ? g.texts[g.texts.length - 1] : ''
    // contiguous (next sample) or a single blank sample in between
    const near = g && t - g.lastT <= interval * 2 + 1e-6 && rows.slice(i - 1, i).every((r) => r.t === g.lastT || !r.text)
    if (g && near && textSimilarity(ref, text) >= same) {
      g.texts.push(text)
      g.lastT = t
    } else groups.push({ texts: [text], firstT: t, lastT: t })
  }
  return groups.map((g) => {
    // the most frequent reading wins (ties → the longest, it usually has every word)
    const count = new Map<string, number>()
    for (const s of g.texts) count.set(s, (count.get(s) ?? 0) + 1)
    const text = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0]
    // without a pixel scan: the line began somewhere between the previous sample and the first reading → midpoint
    return { text, firstT: g.firstT, lastT: g.lastT, start: r2(Math.max(0, g.firstT - interval / 2)), end: r2(g.lastT + interval / 2) }
  })
}

/**
 * "Text pixels" of a small greyscale frame of the subtitle band: bright pixels next to a much darker one
 * (subtitles are light text with a dark outline, shadow or box), which ignores most of the moving picture.
 */
export function textMask(gray: Uint8Array, w: number, h: number): Uint8Array {
  // darkest pixel within ±2 px (a 5×5 minimum), done as a row pass then a column pass
  const rowMin = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const o = y * w
    for (let x = 0; x < w; x++) {
      let m = 255
      for (let dx = Math.max(0, x - 2); dx <= Math.min(w - 1, x + 2); dx++) if (gray[o + dx] < m) m = gray[o + dx]
      rowMin[o + x] = m
    }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x]
      if (v < 165) continue
      let m = 255
      for (let dy = Math.max(0, y - 2); dy <= Math.min(h - 1, y + 2); dy++) if (rowMin[dy * w + x] < m) m = rowMin[dy * w + x]
      if (v - m >= 100) out[y * w + x] = 1
    }
  return out
}

/** How different two masks are: 0 (same text) … 1 (completely different / text appeared or left). */
export function maskChange(a: Uint8Array, b: Uint8Array): { score: number; union: number } {
  let x = 0
  let u = 0
  for (let i = 0; i < a.length; i++) {
    const p = a[i] | b[i]
    if (p) {
      u++
      if (a[i] !== b[i]) x++
    }
  }
  return { score: u ? x / u : 0, union: u }
}

/** Per-frame change from the previous frame, from the pixel scan. */
export interface ScanFrame {
  t: number
  score: number
  union: number
}

/**
 * Snap every line's start / end to the strongest text change near it (the frame where the subtitle really
 * appeared / changed / left). Lines with no clear change keep the midpoint estimate. Lines never overlap.
 */
export function refineWithScan(lines: ReadLine[], scan: ScanFrame[], interval: number, duration: number, minScore = 0.3, minUnion = 12): ReadLine[] {
  if (!scan.length) return lines
  const best = (lo: number, hi: number): number | null => {
    let pick: ScanFrame | null = null
    for (const f of scan) {
      if (f.t < lo - 1e-6 || f.t > hi + 1e-6 || f.score < minScore || f.union < minUnion) continue
      if (!pick || f.score > pick.score) pick = f
    }
    return pick ? pick.t : null
  }
  const out = lines.map((l) => {
    const s = best(l.firstT - interval, l.firstT)
    const e = best(l.lastT + 0.05, l.lastT + interval)
    return { ...l, start: r2(s ?? l.start), end: r2(Math.min(duration || Infinity, e ?? l.end)) }
  })
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].end > out[i + 1].start) out[i].end = out[i + 1].start
  }
  return out.filter((l) => l.end - l.start >= 0.2)
}
