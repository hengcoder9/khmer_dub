import { describe, expect, it } from 'vitest'
import { actorStats, autoMatchVoices, matchSpeakers } from '../shared/cast'
import { planChunks } from '../shared/segments'
import type { Actor, Voice } from '../shared/types'

const voices: Voice[] = [
  { id: 'm1', engine: 'edge', name: 'M1', gender: 'male', locale: 'km-KH' },
  { id: 'm2', engine: 'edge', name: 'M2', gender: 'male', locale: 'km-KH' },
  { id: 'f1', engine: 'edge', name: 'F1', gender: 'female', locale: 'km-KH' },
  { id: 'fx', engine: 'edge', name: 'FX', gender: 'female', locale: 'en-US' }
]

describe('cast', () => {
  it('reuses actors by embedding and creates new ones', () => {
    const cast: Actor[] = [{ id: 'A1', label: 'A1', gender: 'male', lines: 0, totalSec: 0, sampleText: '', embedding: [1, 0, 0] }]
    const r = matchSpeakers(
      [
        { id: 'S0', gender: 'female', embedding: [0, 1, 0] },
        { id: 'S1', gender: 'male', embedding: [0.95, 0.1, 0] }
      ],
      cast
    )
    expect(r.mapping).toEqual({ S0: 'A2', S1: 'A1' })
    expect(r.cast).toHaveLength(2)
    expect(r.cast[1].gender).toBe('female')
  })

  it('reuses actors by label when there is no embedding (Gemini)', () => {
    const cast: Actor[] = [{ id: 'A1', label: 'A1', gender: 'male', lines: 3, totalSec: 9, sampleText: '' }]
    const r = matchSpeakers([{ id: 'A1', gender: 'male' }, { id: 'A2', gender: 'female' }], cast)
    expect(r.mapping).toEqual({ A1: 'A1', A2: 'A2' })
    expect(r.cast).toHaveLength(2)
  })

  it('computes stats', () => {
    const a = actorStats([{ id: 'A1', label: 'A1', gender: 'male', lines: 0, totalSec: 0, sampleText: '' }], [
      { id: 's1', start: 0, end: 2, textOriginal: 'hi', textTarget: 'សួស្តី', speed: 1, pitch: 0, volume: 1, actorId: 'A1' },
      { id: 's2', start: 3, end: 3.5, textOriginal: 'x', textTarget: '', speed: 1, pitch: 0, volume: 1, actorId: 'A1' }
    ])
    expect(a[0]).toMatchObject({ lines: 2, totalSec: 2.5, sampleText: 'សួស្តី' })
  })

  it('auto-matches distinct voices by gender and locale', () => {
    const cast: Actor[] = ['male', 'male', 'female', 'female'].map((g, i) => ({
      id: `A${i + 1}`, label: `A${i + 1}`, gender: g as Actor['gender'], lines: 10 - i, totalSec: 0, sampleText: ''
    }))
    expect(autoMatchVoices(cast, voices, 'km').map((a) => a.voiceId)).toEqual(['m1', 'm2', 'f1', 'f1'])
  })
})

describe('planChunks', () => {
  it('returns one chunk for short audio', () => {
    expect(planChunks(500, [])).toEqual([{ start: 0, end: 500 }])
  })
  it('cuts near silences with overlap', () => {
    const c = planChunks(950, [{ start: 290, end: 292 }, { start: 610, end: 612 }])
    expect(c).toEqual([
      { start: 0, end: 291 },
      { start: 289, end: 611 },
      { start: 609, end: 950 }
    ])
    // no silences: falls back to fixed 300 s cuts
    expect(planChunks(1000, []).map((x) => x.end)).toEqual([300, 600, 900, 1000])
  })
})
