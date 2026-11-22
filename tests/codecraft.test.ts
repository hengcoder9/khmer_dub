import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { llmJson, llmText, normalizeBaseUrl, setLlmConfig, testKey } from '../backend/lib/llm'
import { keyPool } from '../backend/lib/keys'

type Call = { url: string; auth?: string; body?: any }
const calls: Call[] = []
let replies: Array<{ status: number; body: unknown }> = []

beforeEach(() => {
  calls.length = 0
  replies = []
  keyPool.set([{ id: 'c1', provider: 'codecraft', key: 'cc-key' }])
  setLlmConfig({ codecraftBaseUrl: 'https://gw.example.com/v1/' })
  vi.stubGlobal('fetch', async (url: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
    calls.push({ url, auth: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : undefined })
    const r = replies.shift() ?? { status: 500, body: { error: { message: 'no reply' } } }
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => vi.unstubAllGlobals())

const ok = (content: string) => ({ status: 200, body: { choices: [{ message: { content } }] } })

describe('CodeCraft (OpenAI-compatible gateway)', () => {
  it('normalises the pasted base URL', () => {
    expect(normalizeBaseUrl(' https://gw.example.com/v1/ ')).toBe('https://gw.example.com/v1')
    expect(normalizeBaseUrl('https://gw.example.com/v1/chat/completions')).toBe('https://gw.example.com/v1')
  })

  it('sends OpenAI-style chat completions with the CodeCraft key and model', async () => {
    replies.push(ok('សួស្តី'))
    const text = await llmText({ provider: 'codecraft', model: 'gemini-3.1-pro', system: 'sys', parts: [{ text: 'hi' }] })
    expect(text).toBe('សួស្តី')
    expect(calls[0].url).toBe('https://gw.example.com/v1/chat/completions')
    expect(calls[0].auth).toBe('Bearer cc-key')
    expect(calls[0].body).toMatchObject({ model: 'gemini-3.1-pro', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] })
  })

  it('sends frames as image_url data for Read Screen', async () => {
    replies.push(ok('[{"t":0,"text":"吸功大法"}]'))
    const rows = await llmJson<Array<{ t: number; text: string }>>({
      provider: 'codecraft',
      model: 'gemini-3.1-pro',
      parts: [{ text: 'Frame t=0' }, { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }, { text: 'read' }]
    })
    expect(rows).toEqual([{ t: 0, text: '吸功大法' }])
    const content = calls[0].body.messages[0].content
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } })
    expect(calls[0].body.response_format).toEqual({ type: 'json_object' })
  })

  it('asks again without JSON mode when the gateway does not support it', async () => {
    replies.push({ status: 400, body: { error: { message: 'response_format json_object is not supported' } } }, ok('{"a":1}'))
    expect(await llmJson({ provider: 'codecraft', model: 'm', parts: [{ text: 'x' }] })).toEqual({ a: 1 })
    expect(calls[1].body.response_format).toBeUndefined()
  })

  it('explains a missing base URL', async () => {
    setLlmConfig({ codecraftBaseUrl: '' })
    await expect(llmText({ provider: 'codecraft', model: 'm', parts: [{ text: 'x' }] })).rejects.toThrow(/CodeCraft base URL/)
  })

  it('Check connection lists the models', async () => {
    replies.push({ status: 200, body: { data: [{ id: 'gemini-3.1-pro' }, { id: 'gemini-3.6-flash' }] } })
    expect(await testKey('codecraft', 'cc-key')).toEqual({ ok: true, detail: '2 models', models: ['gemini-3.1-pro', 'gemini-3.6-flash'] })
    expect(calls[0]).toMatchObject({ url: 'https://gw.example.com/v1/models', auth: 'Bearer cc-key' })
  })
})

describe('CodeCraft “Get API key” link', () => {
  it('points at the site of the pasted base URL', async () => {
    const { codecraftDashboard } = await import('../shared/urls')
    expect(codecraftDashboard('https://api.codecraft.example/v1/')).toBe('https://api.codecraft.example')
    expect(codecraftDashboard('  ')).toBeNull()
    expect(codecraftDashboard('javascript:alert(1)')).toBeNull()
  })
})

describe('Claude organisation keys (workspace header)', () => {
  const seen: Array<Record<string, string>> = []
  const stub = (body: unknown, status = 200) =>
    vi.stubGlobal('fetch', async (_url: string, init: { headers?: Headers | Record<string, string> } = {}) => {
      const h = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : { ...(init.headers ?? {}) }
      seen.push(Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)])))
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    })

  it('sends anthropic-workspace-id when a Workspace ID is set', async () => {
    seen.length = 0
    // the reply streams in the app; a plain 400 is enough to see the request headers (4xx is not retried)
    stub({ type: 'error', error: { type: 'invalid_request_error', message: 'test stop' } }, 400)
    keyPool.set([{ id: 'a1', provider: 'claude', key: 'sk-ant-x' }])
    setLlmConfig({ claudeWorkspaceId: 'wrkspc_123' })
    await expect(llmText({ provider: 'claude', model: 'claude-opus-5-5', parts: [{ text: 'hi' }] })).rejects.toThrow(/test stop/)
    expect(seen[0]['anthropic-workspace-id']).toBe('wrkspc_123')
    setLlmConfig({ claudeWorkspaceId: '' })
  })

  it('explains the "not scoped to a workspace" error in plain words', async () => {
    stub({ type: 'error', error: { type: 'invalid_request_error', message: 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header' } }, 400)
    const r = await testKey('claude', 'sk-ant-x')
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/paste a Workspace ID in Settings → API Keys → Claude/)
  })
})
