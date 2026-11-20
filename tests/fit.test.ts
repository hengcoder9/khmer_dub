import { describe, expect, it } from 'vitest'
import { atempoChain, computeFit, edgeRate, slotFor } from '../shared/fit'

const base = { start: 10, end: 12, syncEnd: false, maxSpeed: 1.6 }

describe('fit', () => {
  it('keeps speed 1 when the clip fits', () => {
    expect(computeFit({ ...base, ttsDur: 1.5 })).toEqual({ slot: 2, speed: 1, fitWarning: false })
  })

  it('speeds up within maxSpeed', () => {
    expect(computeFit({ ...base, ttsDur: 3 })).toEqual({ slot: 2, speed: 1.5, fitWarning: false })
  })

  it('caps at maxSpeed and warns', () => {
    expect(computeFit({ ...base, ttsDur: 4 })).toEqual({ slot: 2, speed: 1.6, fitWarning: true })
  })

  it('syncEnd extends the slot into following silence', () => {
    expect(slotFor({ ...base, syncEnd: true, nextStart: 13 })).toBeCloseTo(2.95)
    expect(computeFit({ ...base, syncEnd: true, nextStart: 13, ttsDur: 2.9 }).speed).toBe(1)
  })

  it('syncEnd never shrinks the slot and respects media end', () => {
    expect(slotFor({ ...base, syncEnd: true, nextStart: 11.5 })).toBe(2)
    expect(slotFor({ ...base, syncEnd: true, mediaEnd: 11 })).toBe(1)
    expect(slotFor({ ...base, syncEnd: true, mediaEnd: 20 })).toBe(10)
  })

  it('chains atempo outside 0.5–2.0', () => {
    expect(atempoChain(1.3)).toBe('atempo=1.3')
    expect(atempoChain(2.5)).toBe('atempo=2,atempo=1.25')
    expect(atempoChain(0.25)).toBe('atempo=0.5,atempo=0.5')
    expect(() => atempoChain(0)).toThrow()
  })

  it('formats edge rate', () => {
    expect(edgeRate(1)).toBe('+0%')
    expect(edgeRate(1.25)).toBe('+25%')
    expect(edgeRate(0.9)).toBe('-10%')
  })
})
