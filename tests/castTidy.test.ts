import { describe, expect, it } from 'vitest'
import type { Actor, Segment, Voice } from '../shared/types'
import { autoMatchVoices, parseVoiceVariant, tidyCast, withVariants } from '../shared/cast'

const actor = (id: string, gender: Actor['gender'], embedding?: number[]): Actor => ({ id, label: id, gender, lines: 0, totalSec: 0, sampleText: '', embedding })
const lines = (actorId: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${actorId}-${i}`, actorId }) as Segment)

describe('voice variants', () => {
  it('parses the variant suffix', () => {
    expect(parseVoiceVariant('km-KH-PisethNeural#-14,0.95')).toEqual({ base: 'km-KH-PisethNeural', pitch: -14, rate: 0.95 })
    expect(parseVoiceVariant('km-KH-PisethNeural')).toEqual({ base: 'km-KH-PisethNeural', pitch: 0, rate: 1 })
  })
  it('gives nine different Khmer male voices', () => {
    const piseth: Voice = { id: 'edge:km-KH-PisethNeural', engine: 'edge', name: 'Piseth (km-KH)', gender: 'male', locale: 'km-KH' }
    const v = withVariants(piseth)
    expect(v.map((x) => x.name)).toEqual([
      'Piseth (km-KH)', 'Piseth – Deep (km-KH)', 'Piseth – Old (km-KH)', 'Piseth – Young (km-KH)', 'Piseth – Boy (km-KH)',
      'Piseth – Calm (km-KH)', 'Piseth – Strong (km-KH)', 'Piseth – Teen (km-KH)', 'Piseth – Grandpa (km-KH)'
    ])
    // every variant is a different sound (pitch, rate)
    expect(new Set(v.map((x) => x.id)).size).toBe(9)
    const cast = ['A1', 'A2', 'A3'].map((id) => actor(id, 'male'))
    const ids = autoMatchVoices(cast, v, 'km').map((a) => a.voiceId)
    expect(new Set(ids).size).toBe(3)
  })
})

describe('tidyCast', () => {
  it('merges small actors into the closest same-gender main actor', () => {
    const cast = [actor('A1', 'male', [1, 0]), actor('A2', 'female', [0, 1]), actor('A3', 'male', [0.9, 0.1]), actor('A4', 'female', [0.1, 0.9])]
    const segs = [...lines('A1', 40), ...lines('A2', 30), ...lines('A3', 1), ...lines('A4', 2)]
    const r = tidyCast(cast, segs)
    expect(r.cast.map((a) => a.id)).toEqual(['A1', 'A2'])
    expect(r.remap).toEqual({ A3: 'A1', A4: 'A2' })
  })
  it('caps the cast size', () => {
    const cast = Array.from({ length: 14 }, (_, i) => actor(`A${i + 1}`, i % 2 ? 'female' : 'male'))
    const segs = cast.flatMap((a, i) => lines(a.id, 20 - i))
    expect(tidyCast(cast, segs, 10).cast).toHaveLength(10)
  })
})
