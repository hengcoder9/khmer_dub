// API key pool: per-provider routing (round-robin by default), 60 s cooldown on HTTP 429, per-key telemetry.
// Keys live only in memory here.

import { emit } from './events'

export type Provider = 'gemini' | 'openrouter' | 'claude' | 'codecraft'

/**
 * spread   — round-robin over ready keys (every key shares the load)
 * rotate   — stay on one key until it fails or cools down, then move to the next
 * adaptive — pick the ready key with the best success rate / latency / fewest requests in flight
 */
export type RouteMode = 'spread' | 'rotate' | 'adaptive'

export interface PoolKey {
  id: string
  provider: Provider
  key: string
  coolUntil: number
}

export interface KeyStats {
  calls: number
  ok: number
  fail: number
  totalMs: number
  lastMs: number
  inFlight: number
  lastUsed: number
  lastError?: string
}

export interface CallRecord {
  at: number
  keyId: string
  provider: Provider
  model: string
  ok: boolean
  ms: number
  error?: string
  /** "app" for the studio's own jobs, "gateway" for /v1 requests from other tools */
  source: string
}

const emptyStats = (): KeyStats => ({ calls: 0, ok: 0, fail: 0, totalMs: 0, lastMs: 0, inFlight: 0, lastUsed: 0 })
const TELEMETRY_MAX = 300

export class KeyPool {
  private keys: PoolKey[] = []
  private cursor: Record<Provider, number> = { gemini: 0, openrouter: 0, claude: 0, codecraft: 0 }
  private stat = new Map<string, KeyStats>()
  private log: CallRecord[] = []
  mode: RouteMode = 'spread'
  constructor(private now: () => number = Date.now, private onChange: () => void = () => {}) {}

  set(keys: Array<{ id: string; provider: Provider; key: string }>): void {
    const old = new Map(this.keys.map((k) => [k.id, k.coolUntil]))
    this.keys = keys.map((k) => ({ ...k, coolUntil: old.get(k.id) ?? 0 }))
    for (const id of [...this.stat.keys()]) if (!this.keys.some((k) => k.id === id)) this.stat.delete(id)
    this.onChange()
  }

  has(provider: Provider): boolean {
    return this.keys.some((k) => k.provider === provider)
  }

  all(provider: Provider): PoolKey[] {
    return this.keys.filter((k) => k.provider === provider)
  }

  statsOf(id: string): KeyStats {
    let s = this.stat.get(id)
    if (!s) this.stat.set(id, (s = emptyStats()))
    return s
  }

  /** Next ready key for the routing mode, or the one that recovers soonest plus how long to wait. */
  next(provider: Provider): { key: PoolKey; waitMs: number } {
    const list = this.all(provider)
    if (!list.length) throw new Error(`No ${{ gemini: 'Gemini', openrouter: 'OpenRouter', claude: 'Claude', codecraft: 'CodeCraft' }[provider]} API key. Add one in Settings → API Keys.`)
    const t = this.now()
    const ready = list.filter((k) => k.coolUntil <= t)
    if (ready.length && this.mode === 'adaptive') {
      const score = (k: PoolKey) => {
        const s = this.statsOf(k.id)
        const rate = (s.ok + 1) / (s.calls + 2) // optimistic for unused keys
        const avg = s.ok ? s.totalMs / s.ok : 3000
        return rate * 10 - s.inFlight * 2 - avg / 10_000
      }
      const best = ready.reduce((a, b) => (score(b) > score(a) ? b : a))
      this.cursor[provider] = list.indexOf(best) + 1
      return { key: best, waitMs: 0 }
    }
    if (ready.length && this.mode === 'rotate') {
      // keep using the current key while it is healthy
      const cur = list[(this.cursor[provider] + list.length - 1) % list.length]
      if (cur && cur.coolUntil <= t && this.cursor[provider] > 0) return { key: cur, waitMs: 0 }
    }
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

  /** "Skip cooldown": make a cooling key usable right away. */
  uncool(id: string): boolean {
    const k = this.keys.find((x) => x.id === id)
    if (!k) return false
    k.coolUntil = 0
    this.onChange()
    return true
  }

  /** Mark a request as started on a key; call the returned function when it ends. */
  begin(id: string, provider: Provider, model: string, source = 'app'): (ok: boolean, error?: string) => void {
    const s = this.statsOf(id)
    const start = this.now()
    s.inFlight++
    s.lastUsed = start
    let ended = false
    return (ok, error) => {
      if (ended) return
      ended = true
      const ms = this.now() - start
      s.inFlight = Math.max(0, s.inFlight - 1)
      s.calls++
      s.lastMs = ms
      if (ok) {
        s.ok++
        s.totalMs += ms
      } else {
        s.fail++
        s.lastError = error?.slice(0, 300)
      }
      this.log.push({ at: start, keyId: id, provider, model, ok, ms, error: error?.slice(0, 300), source })
      if (this.log.length > TELEMETRY_MAX) this.log.splice(0, this.log.length - TELEMETRY_MAX)
    }
  }

  telemetry(limit = 120): CallRecord[] {
    return this.log.slice(-limit).reverse()
  }

  /** Everything the gateway panel shows — never the secret key itself. */
  snapshot() {
    const t = this.now()
    return this.keys.map((k) => ({
      id: k.id,
      provider: k.provider,
      coolMs: Math.max(0, k.coolUntil - t),
      ...this.statsOf(k.id)
    }))
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
