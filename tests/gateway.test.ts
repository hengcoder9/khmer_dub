import { describe, expect, it } from 'vitest'
import { KeyPool } from '../backend/lib/keys'
import { routeModel, toParts } from '../backend/lib/gateway'

const pool = (mode: 'spread' | 'rotate' | 'adaptive', now = () => 1000) => {
  const p = new KeyPool(now)
  p.mode = mode
  p.set([
    { id: 'a', provider: 'gemini', key: 'A' },
    { id: 'b', provider: 'gemini', key: 'B' },
    { id: 'c', provider: 'gemini', key: 'C' }
  ])
  return p
}

describe('key routing modes', () => {
  it('spread: round-robin over every key', () => {
    const p = pool('spread')
    expect([1, 2, 3, 4].map(() => p.next('gemini').key.id)).toEqual(['a', 'b', 'c', 'a'])
  })

  it('rotate: stays on one key until it cools, then moves on', () => {
    const p = pool('rotate')
    expect([1, 2, 3].map(() => p.next('gemini').key.id)).toEqual(['a', 'a', 'a'])
    p.cool('a')
    expect(p.next('gemini').key.id).toBe('b')
    expect(p.next('gemini').key.id).toBe('b')
  })

  it('adaptive: avoids keys that fail and keys that are busy', () => {
    const p = pool('adaptive')
    for (let i = 0; i < 5; i++) p.begin('a', 'gemini', 'm')(false, '500')
    p.begin('b', 'gemini', 'm') // one request still running on b
    expect(p.next('gemini').key.id).toBe('c')
  })

  it('skips cooled keys and can uncool them', () => {
    const p = pool('spread')
    p.cool('a', 60_000)
    p.cool('b', 60_000)
    p.cool('c', 60_000)
    expect(p.next('gemini').waitMs).toBeGreaterThan(0)
    p.uncool('b')
    expect(p.next('gemini')).toMatchObject({ key: { id: 'b' }, waitMs: 0 })
  })

  it('records telemetry without the secret key', () => {
    let t = 0
    const p = pool('spread', () => t)
    const end = p.begin('a', 'gemini', 'gemini-x', 'gateway')
    expect(p.snapshot().find((k) => k.id === 'a')?.inFlight).toBe(1)
    t = 1200
    end(true)
    const snap = p.snapshot().find((k) => k.id === 'a')!
    expect(snap).toMatchObject({ calls: 1, ok: 1, inFlight: 0, lastMs: 1200 })
    expect(JSON.stringify(p.snapshot())).not.toContain('"A"')
    expect(p.telemetry()[0]).toMatchObject({ keyId: 'a', ok: true, ms: 1200, source: 'gateway' })
  })
})

describe('gateway model routing', () => {
  const defaults = { gemini: 'gemini-3.8-flash', claude: 'claude-sonnet-5-5', openrouter: 'x/y', codecraft: 'cc' }
  const all = () => true
  it('routes by model name', () => {
    expect(routeModel('claude-opus-5-5', defaults, all)).toEqual({ provider: 'claude', model: 'claude-opus-5-5' })
    expect(routeModel('models/gemini-3.8-flash', defaults, all)).toEqual({ provider: 'gemini', model: 'gemini-3.8-flash' })
    expect(routeModel('google/gemini-2.5-flash', defaults, all).provider).toBe('openrouter')
    expect(routeModel('codecraft:gpt-x', defaults, all)).toEqual({ provider: 'codecraft', model: 'gpt-x' })
  })
  it('"auto" picks the first provider that has keys', () => {
    expect(routeModel('auto', defaults, (p) => p === 'claude')).toEqual({ provider: 'claude', model: 'claude-sonnet-5-5' })
  })
})

describe('OpenAI messages → parts', () => {
  it('keeps system, flattens history, passes images', () => {
    const r = toParts([
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }
    ])
    expect(r.system).toBe('Be brief')
    expect((r.parts[0] as { text: string }).text).toContain('User: Hi\n\nAssistant: Hello')
    expect(r.parts[1]).toEqual({ text: 'What is this?' })
    expect(r.parts[2]).toEqual({ inlineData: { mimeType: 'image/png', data: 'AAAA' } })
  })
})

describe('local /v1 server', () => {
  it('needs the gateway key, lists models, and reports upstream errors', async () => {
    const { configureGateway, stopGateway } = await import('../backend/lib/gateway')
    const { keyPool } = await import('../backend/lib/keys')
    keyPool.set([])
    const port = 18000 + Math.floor(Math.random() * 1000)
    const st = await configureGateway({ enabled: true, port, key: 'kd-test', models: { gemini: 'gemini-3.8-flash' } })
    expect(st.listening).toBe(true)
    try {
      const base = `http://127.0.0.1:${port}/v1`
      expect((await fetch(`${base}/models`)).status).toBe(401)
      expect((await fetch(`${base}/models`, { headers: { authorization: 'Bearer wrong!!' } })).status).toBe(401)
      const models = await (await fetch(`${base}/models`, { headers: { authorization: 'Bearer kd-test' } })).json()
      expect(models.data[0].id).toBe('auto')
      // no keys in the pool → clean 502 in OpenAI error shape
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer kd-test', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(r.status).toBe(502)
      expect((await r.json()).error.message).toMatch(/No Gemini API key/)
    } finally {
      await configureGateway({ enabled: false })
      await stopGateway()
    }
  })
})
