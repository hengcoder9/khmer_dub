// Local OpenAI-compatible gateway (/v1) so other tools on this PC can use the studio's API keys and routing.
// Off by default; loopback only; every request needs "Authorization: Bearer <gateway key>".
// No CORS headers are sent, so web pages in a browser cannot read its replies.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { keyPool, type Provider } from './keys'
import { llmText, type Part } from './llm'

export interface GatewayConfig {
  enabled: boolean
  port: number
  key: string
  /** model used for "auto" / unknown names, and listed in /v1/models */
  models: Partial<Record<Provider, string>>
}

let cfg: GatewayConfig = { enabled: false, port: 8766, key: '', models: {} }
let server: Server | null = null
let listening = false
let lastError = ''
let served = 0

export const gatewayState = () => ({ enabled: cfg.enabled, port: cfg.port, listening, error: lastError, served, models: cfg.models })

export async function configureGateway(next: Partial<GatewayConfig>): Promise<ReturnType<typeof gatewayState>> {
  const prev = cfg
  cfg = { ...cfg, ...next, models: { ...cfg.models, ...(next.models ?? {}) } }
  const needRestart = !cfg.enabled || prev.port !== cfg.port || !listening
  if (needRestart) await stop()
  if (cfg.enabled && !listening) await start()
  return gatewayState()
}

function stop(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve()
    const s = server
    server = null
    listening = false
    s.close(() => resolve())
    s.closeAllConnections?.()
  })
}

function start(): Promise<void> {
  lastError = ''
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      handle(req, res).catch((e: Error) => send(res, 500, { error: { message: e.message, type: 'server_error' } }))
    })
    s.once('error', (e: NodeJS.ErrnoException) => {
      lastError = e.code === 'EADDRINUSE' ? `Port ${cfg.port} is already in use` : e.message
      listening = false
      server = null
      resolve()
    })
    s.listen(cfg.port, '127.0.0.1', () => {
      server = s
      listening = true
      resolve()
    })
  })
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function authorized(req: IncomingMessage): boolean {
  const h = req.headers.authorization ?? ''
  const given = Buffer.from(h.replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(cfg.key)
  return want.length > 0 && given.length === want.length && timingSafeEqual(given, want)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 32 * 1024 * 1024) throw new Error('Request too large')
    chunks.push(c as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/** "claude-…" → Claude, "gemini-…" → Gemini, "vendor/model" → OpenRouter, "codecraft:<model>" → CodeCraft. */
export function routeModel(model: string | undefined, defaults: GatewayConfig['models'], has: (p: Provider) => boolean): { provider: Provider; model: string } {
  const m = (model ?? '').trim()
  if (m.startsWith('codecraft:')) return { provider: 'codecraft', model: m.slice(10) }
  if (/^claude/i.test(m)) return { provider: 'claude', model: m }
  if (/^(models\/)?gemini/i.test(m)) return { provider: 'gemini', model: m.replace(/^models\//, '') }
  if (m.includes('/')) return { provider: 'openrouter', model: m }
  // "auto" or anything else: first provider that has keys
  for (const p of ['gemini', 'claude', 'openrouter', 'codecraft'] as Provider[]) {
    if (has(p) && defaults[p]) return { provider: p, model: defaults[p]! }
  }
  return { provider: 'gemini', model: defaults.gemini ?? 'gemini-3.8-flash' }
}

type ChatContent = string | Array<{ type: string; text?: string; image_url?: { url: string } | string }>
interface ChatMessage {
  role: string
  content: ChatContent
}

/** OpenAI messages → one system prompt + the parts of a single turn (earlier turns become a transcript). */
export function toParts(messages: ChatMessage[]): { system?: string; parts: Part[] } {
  const text = (c: ChatContent) => (typeof c === 'string' ? c : c.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n'))
  const system = messages.filter((m) => m.role === 'system' || m.role === 'developer').map((m) => text(m.content)).join('\n\n') || undefined
  const turns = messages.filter((m) => m.role !== 'system' && m.role !== 'developer')
  const parts: Part[] = []
  if (turns.length > 1) {
    const history = turns
      .slice(0, -1)
      .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${text(m.content)}`)
      .join('\n\n')
    parts.push({ text: `Conversation so far:\n${history}\n\nUser:` })
  }
  const last = turns[turns.length - 1]
  if (last) {
    if (typeof last.content === 'string') parts.push({ text: last.content })
    else
      for (const p of last.content) {
        if (p.type === 'text' && p.text) parts.push({ text: p.text })
        const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url
        const m = url?.match(/^data:([^;]+);base64,(.+)$/)
        if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } })
      }
  }
  if (!parts.length) parts.push({ text: '' })
  return { system, parts }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = (req.url ?? '').split('?')[0]
  if (!authorized(req)) return send(res, 401, { error: { message: 'Invalid gateway key (Authorization: Bearer …)', type: 'invalid_request_error' } })

  if (req.method === 'GET' && url === '/v1/models') {
    const data = (Object.entries(cfg.models) as Array<[Provider, string]>)
      .filter(([p, m]) => m && keyPool.has(p))
      .map(([p, m]) => ({ id: p === 'codecraft' ? `codecraft:${m}` : m, object: 'model', owned_by: p, created: 0 }))
    return send(res, 200, { object: 'list', data: [{ id: 'auto', object: 'model', owned_by: 'khmerdub', created: 0 }, ...data] })
  }

  if (req.method === 'POST' && url === '/v1/chat/completions') {
    const body = (await readJson(req)) as { model?: string; messages?: ChatMessage[]; temperature?: number; stream?: boolean; response_format?: { type?: string } }
    if (!Array.isArray(body.messages)) return send(res, 400, { error: { message: '"messages" is required', type: 'invalid_request_error' } })
    const route = routeModel(body.model, cfg.models, (p) => keyPool.has(p))
    const { system, parts } = toParts(body.messages)
    const ac = new AbortController()
    res.on('close', () => !res.writableEnded && ac.abort())
    let text: string
    try {
      text = await llmText({
        provider: route.provider,
        model: route.model,
        system,
        parts,
        temperature: body.temperature,
        json: body.response_format?.type === 'json_object',
        signal: ac.signal,
        source: 'gateway'
      })
    } catch (e) {
      return send(res, 502, { error: { message: (e as Error).message, type: 'upstream_error' } })
    }
    served++
    const id = `chatcmpl-${Date.now().toString(36)}`
    const created = Math.floor(Date.now() / 1000)
    const model = route.provider === 'codecraft' ? `codecraft:${route.model}` : route.model
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const chunk = (delta: object, finish: string | null) =>
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
      chunk({ role: 'assistant', content: text }, null)
      chunk({}, 'stop')
      res.end('data: [DONE]\n\n')
      return
    }
    return send(res, 200, {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    })
  }

  send(res, 404, { error: { message: `Unknown endpoint ${req.method} ${url}`, type: 'invalid_request_error' } })
}

export const stopGateway = stop
