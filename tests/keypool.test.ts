import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('API key pool is one per process', () => {
  it('a second copy of the keys module sees the keys set through the first', async () => {
    const a = await import('../backend/lib/keys')
    a.keyPool.set([{ id: 'k1', provider: 'claude', key: 'x' }])
    vi.resetModules() // like the bundler duplicating backend/lib/keys.ts
    const b = await import('../backend/lib/keys')
    expect(b).not.toBe(a)
    expect(b.keyPool.stats('claude')).toEqual({ total: 1, ready: 1 })
    a.keyPool.set([])
  })

  it('the built backend bundles the key pool once (d:\\ vs D:\\ path casing)', () => {
    const built = join(__dirname, '..', 'out', 'main', 'server.js')
    if (!existsSync(built)) return // not built in this run
    expect(readFileSync(built, 'utf8').match(/class KeyPool/g)).toHaveLength(1)
  })
})
