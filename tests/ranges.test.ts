import { describe, expect, it } from 'vitest'
import {
  addRemoved,
  effectiveClips,
  isRemoved,
  mapCuesToOutput,
  moveClip,
  normalize,
  outputToSource,
  restoreRange,
  sourceToOutput,
  splitClipAt,
  subtract,
  totalDuration
} from '../shared/ranges'

describe('ranges', () => {
  it('normalizes overlapping ranges', () => {
    expect(normalize([{ start: 5, end: 6 }, { start: 1, end: 3 }, { start: 2, end: 4 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 6 }
    ])
  })

  it('subtracts removed ranges', () => {
    expect(subtract({ start: 0, end: 10 }, [{ start: 2, end: 3 }, { start: 8, end: 12 }])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 8 }
    ])
  })

  it('restores part of a removed range', () => {
    const removed = addRemoved([], { start: 2, end: 6 })
    expect(restoreRange(removed, { start: 3, end: 4 })).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 6 }
    ])
    expect(isRemoved(removed, { start: 2.5, end: 5 })).toBe(true)
    expect(isRemoved(removed, { start: 5, end: 9 })).toBe(false)
  })

  it('builds effective clips in user order', () => {
    const clips = [
      { id: 'b', start: 10, end: 20 },
      { id: 'a', start: 0, end: 10 }
    ]
    const eff = effectiveClips({ clips, removed: [{ start: 12, end: 14 }] })
    expect(eff.map((c) => [c.start, c.end])).toEqual([
      [10, 12],
      [14, 20],
      [0, 10]
    ])
    expect(totalDuration(eff)).toBe(18)
  })

  it('maps times both ways', () => {
    const clips = [
      { start: 0, end: 2 },
      { start: 5, end: 8 }
    ]
    expect(sourceToOutput(6, clips)).toBe(3)
    expect(sourceToOutput(3, clips)).toBeNull()
    expect(outputToSource(3, clips)).toBe(6)
    expect(outputToSource(99, clips)).toBeNull()
  })

  it('retimes cues and splits cues across cuts', () => {
    const clips = [
      { start: 0, end: 2 },
      { start: 5, end: 8 }
    ]
    const cues = [
      { start: 1, end: 6, text: 'x' },
      { start: 3, end: 4, text: 'gone' }
    ]
    expect(mapCuesToOutput(cues, clips)).toEqual([
      { start: 1, end: 2, text: 'x' },
      { start: 2, end: 3, text: 'x' }
    ])
  })

  it('splits and moves clips', () => {
    const c = splitClipAt([{ id: 'a', start: 0, end: 10 }], 4, 'b')
    expect(c).toEqual([
      { id: 'a', start: 0, end: 4 },
      { id: 'b', start: 4, end: 10 }
    ])
    expect(splitClipAt(c, 0.01, 'z')).toBe(c)
    expect(moveClip(c, 1, 0).map((x) => x.id)).toEqual(['b', 'a'])
  })
})
