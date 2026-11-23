import { describe, expect, it } from 'vitest'
import { khqrInfo, parseEmv } from '../src/lib/khqr'

const tlv = (tag: string, v: string) => tag + String(v.length).padStart(2, '0') + v
const qr = [tlv('00', '01'), tlv('01', '12'), tlv('29', tlv('00', 'heng@aclb')), tlv('52', '5999'), tlv('53', '840'), tlv('54', '2.00'), tlv('58', 'KH'), tlv('59', 'HENG'), tlv('60', 'Phnom Penh'), tlv('63', 'ABCD')].join('')

describe('KHQR reader', () => {
  it('reads top-level EMV fields', () => {
    const f = parseEmv(qr)
    expect(f['59']).toBe('HENG')
    expect(f['29']).toBe('0009heng@aclb')
  })
  it('gives merchant, city, amount and currency', () => {
    expect(khqrInfo(qr)).toEqual({ merchant: 'HENG', city: 'Phnom Penh', amount: '2.00', currency: 'USD' })
    expect(khqrInfo(qr.replace('5303840', '5303116')).currency).toBe('KHR')
  })
  it('is safe on empty or broken input', () => {
    expect(khqrInfo(null)).toEqual({})
    expect(parseEmv('00xx')).toEqual({})
  })
})
