import { describe, expect, it } from 'vitest'
import { KeyPool } from '../backend/lib/keys'

describe('key pool', () => {
  it('rotates round-robin and skips cooling keys', () => {
    let now = 0
    const pool = new KeyPool(() => now)
    pool.set([
      { id: 'a', provider: 'gemini', key: 'A' },
      { id: 'b', provider: 'gemini', key: 'B' },
      { id: 'c', provider: 'openrouter', key: 'C' }
    ])
    expect(pool.next('gemini').key.id).toBe('a')
    expect(pool.next('gemini').key.id).toBe('b')
    expect(pool.next('gemini').key.id).toBe('a')
    pool.cool('b', 60_000)
    expect(pool.next('gemini').key.id).toBe('a')
    expect(pool.next('gemini').key.id).toBe('a')
    expect(pool.stats('gemini')).toEqual({ total: 2, ready: 1 })
    pool.cool('a', 30_000)
    const r = pool.next('gemini')
    expect(r.key.id).toBe('a')
    expect(r.waitMs).toBe(30_000)
    now = 61_000
    expect(pool.stats('gemini').ready).toBe(2)
  })

  it('throws a helpful error with no keys', () => {
    expect(() => new KeyPool().next('openrouter')).toThrow(/OpenRouter API key/)
  })
})
