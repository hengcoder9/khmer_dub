import { describe, expect, it } from 'vitest'
import { findFillers, removedLineIds, silenceCuts } from '../shared/editor'
import type { Segment } from '../shared/types'

const seg = (id: string, start: number, end: number, words: Array<[number, number, string]> = []): Segment => ({
  id, start, end, textOriginal: '', textTarget: '', speed: 1, pitch: 0, volume: 1,
  words: words.map(([s, e, text]) => ({ start: s, end: e, text }))
})

describe('editor helpers', () => {
  it('finds filler words', () => {
    const r = findFillers([seg('a', 0, 3, [[0, 0.4, ' So'], [0.5, 0.8, ' um,'], [0.9, 1.5, ' hello'], [2, 2.3, ' uh']])])
    expect(r).toEqual([
      { start: 0.47, end: 0.83 },
      { start: 1.97, end: 2.33 }
    ])
  })

  it('ignores "like" inside a sentence', () => {
    expect(findFillers([seg('a', 0, 3, [[0, 0.3, ' I'], [0.32, 0.6, ' like'], [0.62, 1, ' it']])])).toEqual([])
  })

  it('keeps padding around silence cuts', () => {
    expect(silenceCuts([{ start: 1, end: 3 }, { start: 5, end: 5.4 }], 0.8, 0.2)).toEqual([{ start: 1.2, end: 2.8 }])
  })

  it('detects removed lines', () => {
    const ids = removedLineIds([seg('a', 0, 2), seg('b', 2, 4)], [{ start: 1.9, end: 4 }])
    expect([...ids]).toEqual(['b'])
  })
})
