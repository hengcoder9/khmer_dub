import { beforeEach, describe, expect, it, vi } from 'vitest'
import { keyPool } from '../backend/lib/keys'

const calls: string[] = []
let codecraftError = 'CodeCraft 402: Billing verification failed. Please check your payment method.'
vi.mock('../backend/lib/llm', () => ({
  llmJson: vi.fn(async (o: { provider: string; model: string }) => {
    calls.push(`${o.provider}:${o.model}`)
    if (o.provider === 'codecraft') throw new Error(codecraftError)
    return { ok: o.provider }
  })
}))

describe('read screen: when the chosen reader account fails', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('CodeCraft billing failure → Gemini reads instead, and CodeCraft is skipped for a while', async () => {
    const { makeReader } = await import('../backend/pipeline/ocr')
    keyPool.set([{ id: 'g', provider: 'gemini', key: 'x' }])
    const logs: string[] = []
    const read = makeReader('gemini-model', (m) => logs.push(m))
    expect(await read({ provider: 'codecraft', model: 'cc-model', parts: [] })).toEqual({ ok: 'gemini' })
    expect(calls).toEqual(['codecraft:cc-model', 'gemini:gemini-model'])
    expect(logs[0]).toMatch(/Billing verification failed.*reading with Gemini instead/)
    calls.length = 0
    await read({ provider: 'codecraft', model: 'cc-model', parts: [] })
    expect(calls).toEqual(['gemini:gemini-model']) // no second try at the broken account
    keyPool.set([])
  })

  it('a normal error is not hidden; without a Gemini key the real error shows', async () => {
    vi.resetModules()
    const { makeReader } = await import('../backend/pipeline/ocr')
    keyPool.set([{ id: 'g', provider: 'gemini', key: 'x' }])
    codecraftError = 'CodeCraft 500: internal error'
    await expect(makeReader('g')({ provider: 'codecraft', model: 'm', parts: [] })).rejects.toThrow(/500/)
    keyPool.set([])
    codecraftError = 'CodeCraft 402: Billing verification failed.'
    await expect(makeReader('g')({ provider: 'codecraft', model: 'm', parts: [] })).rejects.toThrow(/Billing/)
  })
})
