import { describe, expect, it } from 'vitest'
import { cuesForPart, partName, partRanges, planParts } from '../shared/split'

describe('split into episodes', () => {
  it('no split for full video or short videos', () => {
    expect(planParts(600, 0)).toEqual([])
    expect(planParts(200, 180)).toEqual([]) // under 1.25 parts
  })
  it('cuts every N seconds and merges a tiny tail', () => {
    expect(planParts(1800, 600)).toEqual([600, 1200]) // 30 min → 3 × 10
    expect(planParts(1320, 600)).toEqual([600]) // 22 min → 10 + 12 (2 min tail merged)
    expect(planParts(1500, 600)).toEqual([600, 1200]) // 25 min → 10 + 10 + 5
  })
  it('snaps a cut out of a subtitle line to the nearest gap', () => {
    const cues = [
      { start: 590, end: 597, text: 'a' },
      { start: 598, end: 606, text: 'b' } // covers 600
    ]
    expect(planParts(1800, 600, cues)[0]).toBe(598) // nearest line edge (598) that is outside every line
  })
  it('keeps the target when no gap is near', () => {
    const cues = [{ start: 500, end: 700, text: 'long' }]
    expect(planParts(1800, 600, cues)[0]).toBe(600)
  })
  it('ranges, part cues and names', () => {
    expect(partRanges(1500, [600, 1200])).toEqual([{ start: 0, end: 600 }, { start: 600, end: 1200 }, { start: 1200, end: 1500 }])
    const part = cuesForPart([{ start: 595, end: 605, text: 'x' }, { start: 610, end: 612, text: 'y' }, { start: 10, end: 12, text: 'z' }], 600, 1200)
    expect(part).toEqual([{ start: 0, end: 5, text: 'x' }, { start: 10, end: 12, text: 'y' }])
    expect(partName('Show_E01', 0, 3)).toBe('Show_E01 EP01')
    expect(partName('Show_E01', 99, 120)).toBe('Show_E01 EP100')
  })
})
