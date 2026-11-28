import { describe, expect, it } from 'vitest'
import { maskChange, mergeReadings, refineWithScan, textMask, textSimilarity } from '../shared/ocrtiming'

describe('read screen: merging readings', () => {
  it('similar readings are the same line', () => {
    expect(textSimilarity('Hello, how are you?', 'Hello how are you')).toBe(1)
    expect(textSimilarity('你好吗', '你好吗。')).toBe(1)
    expect(textSimilarity('I love you', 'I 1ove you')).toBeGreaterThan(0.8)
    expect(textSimilarity('I love you', 'Where are we going')).toBeLessThan(0.5)
  })

  it('OCR noise and a one-sample blink do not split a line; the most common reading wins', () => {
    const r = mergeReadings(
      [
        { t: 0, text: '' },
        { t: 1, text: 'Hello there.' },
        { t: 2, text: 'Hello there' },
        { t: 3, text: '' }, // blink
        { t: 4, text: 'Hello there.' },
        { t: 5, text: 'Goodbye' },
        { t: 6, text: 'Goodbye' },
        { t: 7, text: '' },
        { t: 8, text: '' },
        { t: 9, text: 'Goodbye' } // after a real gap: a new line
      ],
      1
    )
    expect(r.map((l) => [l.text, l.firstT, l.lastT])).toEqual([
      ['Hello there.', 1, 4],
      ['Goodbye', 5, 6],
      ['Goodbye', 9, 9]
    ])
    // without a scan: midpoints between samples
    expect(r[0]).toMatchObject({ start: 0.5, end: 4.5 })
  })
})

describe('read screen: exact timing from the pixel scan', () => {
  it('text pixels: light text with a dark edge, not a plain bright area', () => {
    const w = 12
    const h = 5
    const g = new Uint8Array(w * h).fill(40)
    for (let x = 3; x < 6; x++) g[2 * w + x] = 240 // "text" on dark
    for (let x = 8; x < 12; x++) for (let y = 0; y < h; y++) g[y * w + x] = 200 // flat bright area... edge pixels only
    const m = textMask(g, w, h)
    expect(m[2 * w + 4]).toBe(1)
    expect(m[2 * w + 11]).toBe(0) // inside the flat bright area (no dark pixel within 2 px)
    expect(maskChange(m, m).score).toBe(0)
    expect(maskChange(m, new Uint8Array(w * h)).score).toBe(1)
  })

  it('snaps start / end to the frame where the subtitle really appears and leaves', () => {
    const lines = mergeReadings(
      [
        { t: 0, text: '' },
        { t: 1, text: 'A' },
        { t: 2, text: 'A' },
        { t: 3, text: 'B' },
        { t: 4, text: '' }
      ],
      1
    )
    // real changes: A appears at 0.7, A→B at 2.4, B leaves at 3.3 (plus small background noise)
    const scan = Array.from({ length: 50 }, (_, i) => {
      const t = Math.round(i * 10) / 100
      const big = [0.7, 2.4, 3.3].includes(t)
      return { t, score: big ? 0.9 : 0.05, union: 200 }
    })
    const r = refineWithScan(lines, scan, 1, 10)
    expect(r.map((l) => [l.text, l.start, l.end])).toEqual([
      ['A', 0.7, 2.4],
      ['B', 2.4, 3.3]
    ])
  })

  it('no clear change nearby: keeps the midpoint estimate', () => {
    const lines = mergeReadings([{ t: 0, text: '' }, { t: 1, text: 'A' }, { t: 2, text: '' }], 1)
    const r = refineWithScan(lines, [{ t: 0.5, score: 0.1, union: 300 }], 1, 10)
    expect(r[0]).toMatchObject({ start: 0.5, end: 1.5 })
  })
})
