import { describe, expect, it } from 'vitest'
import { daysLeft, hasAccess } from '../src/store/account'
import type { AccountAccess } from '../shared/types'

const at = (ms: number) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ')
const acc = (p: Partial<AccountAccess>): AccountAccess => ({ active: true, kind: 'paid', plan: '1 Month', planCode: '1m', endsAt: null, daysLeft: 0, trialEndsAt: null, ...p })

describe('subscription access (works offline from the cached end date)', () => {
  it('needs a signed-in account', () => {
    expect(hasAccess({ signedIn: false, access: acc({ kind: 'lifetime' }) })).toBe(false)
  })
  it('lifetime never expires', () => {
    expect(hasAccess({ signedIn: true, access: acc({ kind: 'lifetime' }) })).toBe(true)
    expect(daysLeft(acc({ kind: 'lifetime' }))).toBeNull()
  })
  it('paid / trial plans end at endsAt', () => {
    expect(hasAccess({ signedIn: true, access: acc({ endsAt: at(5 * 86_400_000) }) })).toBe(true)
    expect(hasAccess({ signedIn: true, access: acc({ kind: 'trial', endsAt: at(-60_000) }) })).toBe(false)
    expect(daysLeft(acc({ endsAt: at(2.5 * 86_400_000) }))).toBe(3)
  })
  it('no plan → locked', () => {
    expect(hasAccess({ signedIn: true, access: acc({ kind: 'none', active: false }) })).toBe(false)
  })
})
