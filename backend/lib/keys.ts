// API key pool: round-robin per provider, 60 s cooldown on HTTP 429. Keys live only in memory here.

import { emit } from './events'

export type Provider = 'gemini' | 'openrouter' | 'claude' | 'codecraft'

export interface PoolKey {
  id: string
  provider: Provider
  key: string
  coolUntil: number
}

export class KeyPool {
  private keys: PoolKey[] = []
  private cursor: Record<Provider, number> = { gemini: 0, openrouter: 0, claude: 0, codecraft: 0 }
  constructor(private now: () => number = Date.now, private onChange: () => void = () => {}) {}

  set(keys: Array<{ id: string; provider: Provider; key: string }>): void {
    const old = new Map(this.keys.map((k) => [k.id, k.coolUntil]))
    this.keys = keys.map((k) => ({ ...k, coolUntil: old.get(k.id) ?? 0 }))
    this.onChange()
  }

  has(provider: Provider): boolean {
    return this.keys.some((k) => k.provider === provider)
  }

  all(provider: Provider): PoolKey[] {
    return this.keys.filter((k) => k.provider === provider)
  }

  /** Next ready key (round-robin), or the one that recovers soonest plus how long to wait. */
  next(provider: Provider): { key: PoolKey; waitMs: number } {
    const list = this.all(provider)
    if (!list.length) throw new Error(`No ${{ gemini: 'Gemini', openrouter: 'OpenRouter', claude: 'Claude', codecraft: 'CodeCraft' }[provider]} API key. Add one in Settings → API Keys.`)
    const t = this.now()
    for (let i = 0; i < list.length; i++) {
      const idx = (this.cursor[provider] + i) % list.length
      if (list[idx].coolUntil <= t) {
        this.cursor[provider] = idx + 1
        return { key: list[idx], waitMs: 0 }
      }
    }
    const soonest = list.reduce((a, b) => (a.coolUntil <= b.coolUntil ? a : b))
    return { key: soonest, waitMs: soonest.coolUntil - t }
  }

  cool(id: string, ms = 60_000): void {
    const k = this.keys.find((x) => x.id === id)
    if (k) {
      k.coolUntil = this.now() + ms
      this.onChange()
    }
  }

  stats(provider?: Provider): { total: number; ready: number } {
    const t = this.now()
    const list = provider ? this.all(provider) : this.keys
    return { total: list.length, ready: list.filter((k) => k.coolUntil <= t).length }
  }
}

// One pool per process, even if the bundler ends up with two copies of this module (it did: building from "d:\" vs
// "D:\" made server.ts fill one copy while the AI calls read the other, so every cloud job said "No API key").
const g = globalThis as unknown as { __kdKeyPool?: KeyPool }
export const keyPool: KeyPool = (g.__kdKeyPool ??= new KeyPool(Date.now, () => emit({ type: 'keys', ...keyPool.stats('gemini') })))

// re-announce when cooldowns expire so the footer "Keys 7/8" recovers on its own
setInterval(() => {
  const s = keyPool.stats('gemini')
  if (s.ready < s.total) emit({ type: 'keys', ...s })
}, 5_000).unref()
