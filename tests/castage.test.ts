import { describe, expect, it } from 'vitest'
import type { Actor, Voice } from '../shared/types'
import { autoMatchVoices, voiceAge, withVariants } from '../shared/cast'
import { ageFromPitch, sampleRanges } from '../backend/pipeline/castvoice'

const KM: Voice[] = [
  ...withVariants({ id: 'edge:km-KH-PisethNeural', engine: 'edge', name: 'Piseth (Khmer)', gender: 'male', locale: 'km-KH' }),
  ...withVariants({ id: 'edge:km-KH-SreymomNeural', engine: 'edge', name: 'Sreymom (Khmer)', gender: 'female', locale: 'km-KH' })
]
const actor = (id: string, gender: Actor['gender'], age: Actor['age'], lines = 10): Actor => ({ id, label: id, gender, age, lines, totalSec: lines * 2, sampleText: '' })
const name = (id?: string) => KM.find((v) => v.id === id)?.name

describe('voices by gender and age', () => {
  it('every variant knows its age', () => {
    expect(voiceAge(KM[0])).toBe('adult') // the base voice
    const byName = (n: string) => KM.find((v) => v.name.includes(n))!
    expect(voiceAge(byName('Boy'))).toBe('child')
    expect(voiceAge(byName('Girl'))).toBe('child')
    expect(voiceAge(byName('Teen'))).toBe('teen')
    expect(voiceAge(byName('Grandpa'))).toBe('senior')
    expect(voiceAge(byName('Grandma'))).toBe('senior')
  })

  it('man / woman / boy / girl / teen / old man / old woman each get a fitting, different voice', () => {
    const cast = [
      actor('A1', 'male', 'adult', 50),
      actor('A2', 'female', 'adult', 40),
      actor('A3', 'male', 'child', 30),
      actor('A4', 'female', 'child', 20),
      actor('A5', 'female', 'teen', 15),
      actor('A6', 'male', 'senior', 12),
      actor('A7', 'female', 'senior', 11),
      actor('A8', 'male', 'adult', 9)
    ]
    const m = autoMatchVoices(cast, KM, 'km')
    const v = (id: string) => KM.find((x) => x.id === m.find((a) => a.id === id)!.voiceId)!
    expect(v('A1').gender).toBe('male')
    expect(voiceAge(v('A1'))).toBe('adult')
    expect(name(v('A3').id)).toContain('Boy')
    expect(name(v('A4').id)).toContain('Girl')
    expect(voiceAge(v('A5'))).toBe('teen')
    expect(v('A5').gender).toBe('female')
    expect(voiceAge(v('A6'))).toBe('senior')
    expect(v('A6').gender).toBe('male')
    expect(voiceAge(v('A7'))).toBe('senior')
    expect(v('A7').gender).toBe('female')
    // two adult men get two different voices
    expect(v('A8').id).not.toBe(v('A1').id)
    expect(voiceAge(v('A8'))).toBe('adult')
  })

  it('a child of unknown gender gets a child voice; no age = adult like before', () => {
    const m = autoMatchVoices([actor('A1', 'unknown', 'child'), actor('A2', 'male', undefined)], KM, 'km')
    expect(voiceAge(KM.find((x) => x.id === m[0].voiceId)!)).toBe('child')
    expect(voiceAge(KM.find((x) => x.id === m[1].voiceId)!)).toBe('adult')
  })
})

describe('voice samples and pitch fallback', () => {
  it('a very high voice is a child', () => {
    expect(ageFromPitch(300)).toBe('child')
    expect(ageFromPitch(210)).toBe('adult')
    expect(ageFromPitch(120)).toBe('adult')
    expect(ageFromPitch(undefined)).toBe('adult')
  })

  it('samples the longest lines up to ~10 s, in time order', () => {
    const r = sampleRanges([
      { start: 0, end: 0.4 }, // too short
      { start: 10, end: 13 },
      { start: 20, end: 26 },
      { start: 30, end: 32 },
      { start: 40, end: 41 },
      { start: 50, end: 70 } // long: capped at 10 s
    ])
    expect(r).toEqual([{ start: 20, end: 26 }, { start: 50, end: 60 }, { start: 10, end: 13 }].sort((a, b) => a.start - b.start))
  })
})
