import { describe, expect, it } from 'vitest'
import { clampOverlaps, dedupeByTime, mergeShort, postProcess, splitLong } from '../shared/segments'
import { assColor, toAss, tokenize } from '../shared/captions'
import { DEFAULT_CAPTIONS } from '../shared/captions'

describe('segments', () => {
  it('merges short segments into the nearest neighbour', () => {
    const out = mergeShort([
      { start: 0, end: 2, text: 'Hello' },
      { start: 2.1, end: 2.4, text: 'there' },
      { start: 5, end: 7, text: 'Next' }
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ start: 0, end: 2.4, text: 'Hello there' })
  })

  it('keeps isolated short lines', () => {
    expect(mergeShort([{ start: 0, end: 0.3, text: 'Hi' }, { start: 10, end: 12, text: 'x' }])).toHaveLength(2)
  })

  it('splits long segments at punctuation', () => {
    const out = splitLong([{ start: 0, end: 12, text: 'This is the first part, and this is the second part of it.' }])
    expect(out).toHaveLength(2)
    expect(out[0].text).toBe('This is the first part,')
    expect(out[1].end).toBe(12)
  })

  it('splits long segments using word timings', () => {
    const words = [
      { start: 0, end: 3, text: 'One' },
      { start: 3, end: 5, text: ' two.' },
      { start: 5, end: 10, text: ' three' }
    ]
    const out = splitLong([{ start: 0, end: 10, text: 'One two. three', words }])
    expect(out.map((s) => [s.start, s.end, s.text])).toEqual([
      [0, 5, 'One two.'],
      [5, 10, 'three']
    ])
  })

  it('clamps overlaps', () => {
    expect(clampOverlaps([{ start: 0, end: 3, text: 'a' }, { start: 2, end: 4, text: 'b' }])[0].end).toBe(2)
  })

  it('dedupes chunk overlaps', () => {
    const out = dedupeByTime([
      { start: 299, end: 301, text: 'Same line here' },
      { start: 299.2, end: 301, text: 'Same line here' },
      { start: 302, end: 303, text: 'Other' }
    ])
    expect(out).toHaveLength(2)
  })

  it('postProcess drops empty text', () => {
    expect(postProcess([{ start: 0, end: 1, text: '  ' }, { start: 1, end: 2, text: 'ok' }])).toHaveLength(1)
  })
})

describe('captions', () => {
  it('converts colors to ASS BGR', () => {
    expect(assColor('#FF8800')).toBe('&H000088FF')
    expect(assColor('#000000', 0.5)).toBe('&H80000000')
  })

  it('tokenizes Khmer without spaces into several words', () => {
    expect(tokenize('ខ្ញុំស្រលាញ់អ្នក').length).toBeGreaterThan(1)
  })

  it('renders karaoke and word modes', () => {
    const cues = [{ start: 1, end: 3, text: 'hello big world' }]
    const k = toAss(cues, { ...DEFAULT_CAPTIONS, mode: 'karaoke' }, 1920, 1080, 'en')
    expect(k).toContain('PlayResY: 1080')
    expect(k).toMatch(/\{\\kf\d+\}hello/)
    const w = toAss(cues, { ...DEFAULT_CAPTIONS, mode: 'word' }, 1080, 1920, 'en')
    expect(w.match(/^Dialogue/gm)).toHaveLength(3)
  })
})
