import { describe, expect, it } from 'vitest'
import { synthHedged } from '../backend/lib/edgeTts'
import { CanceledError } from '../backend/queue'

type Plan = { failAt?: number; audioAt?: number; doneAt?: number; status?: number }

/** fake Edge request: each attempt follows the next plan (drop after failAt ms, or audio at audioAt / done at doneAt) */
function fake(plans: Plan[]) {
  let n = 0
  const log: string[] = []
  const chunk = (_t: string, o: { signal?: AbortSignal; onAudio?: () => void }) =>
    new Promise<Buffer>((resolve, reject) => {
      const k = n++
      const p = plans[Math.min(k, plans.length - 1)]
      log.push(`start ${k}`)
      const timers: NodeJS.Timeout[] = []
      o.signal?.addEventListener('abort', () => {
        timers.forEach(clearTimeout)
        log.push(`abort ${k}`)
        reject(new CanceledError())
      })
      if (p.failAt !== undefined)
        timers.push(setTimeout(() => reject(Object.assign(new Error('Edge-TTS connection closed (1006)'), p.status ? { status: p.status } : {})), p.failAt))
      else {
        timers.push(setTimeout(() => o.onAudio?.(), p.audioAt ?? 0))
        timers.push(setTimeout(() => resolve(Buffer.from(`audio ${k}`)), p.doneAt ?? (p.audioAt ?? 0) + 10))
      }
    })
  return { chunk, log, count: () => n }
}

describe('hedged Edge-TTS requests', () => {
  it('a silent request gets a second copy; the first answer wins and the other is dropped', async () => {
    const f = fake([{ failAt: 300 }, { audioAt: 20 }])
    const t0 = Date.now()
    const buf = await synthHedged('x', { voice: 'v', hedgeMs: 50 }, f.chunk)
    expect(buf.toString()).toBe('audio 1')
    expect(Date.now() - t0).toBeLessThan(250) // did not wait for the stalled one to drop
    expect(f.log).toContain('abort 0')
  })

  it('a healthy voice sends only one request', async () => {
    const f = fake([{ audioAt: 5, doneAt: 120 }])
    await synthHedged('x', { voice: 'v', hedgeMs: 50 }, f.chunk)
    expect(f.count()).toBe(1)
  })

  it('dropped requests are sent again at once, up to the attempt limit', async () => {
    const f = fake([{ failAt: 5 }, { failAt: 5 }, { failAt: 5 }, { audioAt: 5 }])
    expect((await synthHedged('x', { voice: 'v', hedgeMs: 1000 }, f.chunk)).toString()).toBe('audio 3')
    const g = fake([{ failAt: 5 }])
    await expect(synthHedged('x', { voice: 'v', hedgeMs: 1000 }, g.chunk)).rejects.toThrow(/1006/)
    expect(g.count()).toBe(8)
  })

  it('a refused handshake (HTTP status) is returned at once, not hedged', async () => {
    const f = fake([{ failAt: 5, status: 403 }])
    await expect(synthHedged('x', { voice: 'v', hedgeMs: 1000 }, f.chunk)).rejects.toMatchObject({ status: 403 })
    expect(f.count()).toBe(1)
  })

  it('cancel stops every copy', async () => {
    const f = fake([{ audioAt: 1000 }])
    const ac = new AbortController()
    const p = synthHedged('x', { voice: 'v', hedgeMs: 20, signal: ac.signal }, f.chunk)
    setTimeout(() => ac.abort(), 80)
    await expect(p).rejects.toBeInstanceOf(CanceledError)
    expect(f.count()).toBe(3) // never more than 3 at once
    expect(f.log.filter((l) => l.startsWith('abort'))).toHaveLength(3)
  })
})
