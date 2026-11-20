// Gemini (REST), OpenRouter (OpenAI-compatible) and Claude (Anthropic SDK) clients with key rotation and 429 cooldown.

import Anthropic from '@anthropic-ai/sdk'
import { keyPool, type Provider } from './keys'
import { extractJson } from '../../shared/translate'

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

export interface LlmOptions {
  provider: Provider
  model: string
  system?: string
  parts: Part[]
  /** Gemini responseSchema (OpenAPI subset); forces JSON output */
  schema?: unknown
  json?: boolean
  temperature?: number
  signal?: AbortSignal
}

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'
const OPENROUTER = 'https://openrouter.ai/api/v1'

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(Object.assign(new Error('Canceled'), { name: 'AbortError' }))
    })
  })

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function readError(res: Response): Promise<string> {
  const txt = await res.text().catch(() => '')
  try {
    const j = JSON.parse(txt)
    return j.error?.message ?? j.message ?? txt.slice(0, 300)
  } catch {
    return txt.slice(0, 300) || res.statusText
  }
}

/** Retired model → replacement Google named in its 404 ("...no longer available... use models/X"). */
const geminiReplacements = new Map<string, string>()
export const retiredGeminiModels = () => Object.fromEntries(geminiReplacements)

async function callGemini(key: string, o: LlmOptions): Promise<string> {
  const model = geminiReplacements.get(o.model) ?? o.model
  try {
    return await callGeminiOnce(key, { ...o, model })
  } catch (e) {
    const m = e instanceof HttpError && e.status === 404 && /no longer available|deprecated|not found/i.test(e.message)
      ? /use (?:models\/)?(gemini-[\w.-]+)/i.exec(e.message)
      : null
    if (!m || m[1] === model) throw e
    geminiReplacements.set(o.model, m[1])
    return callGeminiOnce(key, { ...o, model: m[1] })
  }
}

async function callGeminiOnce(key: string, o: LlmOptions): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: o.parts }],
    generationConfig: {
      temperature: o.temperature ?? 0.3,
      ...(o.schema || o.json ? { responseMimeType: 'application/json' } : {}),
      ...(o.schema ? { responseSchema: o.schema } : {})
    }
  }
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] }
  const res = await fetch(`${GEMINI}/models/${encodeURIComponent(o.model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000)
  })
  if (!res.ok) throw new HttpError(res.status, `Gemini ${res.status}: ${await readError(res)}`)
  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
    promptFeedback?: { blockReason?: string }
  }
  if (j.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request: ${j.promptFeedback.blockReason}`)
  const c = j.candidates?.[0]
  const text = c?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error(`Gemini returned no text (finishReason: ${c?.finishReason ?? 'unknown'})`)
  return text
}

async function callOpenRouter(key: string, o: LlmOptions): Promise<string> {
  const content = o.parts.map((p) =>
    'text' in p ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }
  )
  const messages = [
    ...(o.system ? [{ role: 'system', content: o.system }] : []),
    { role: 'user', content: content.length === 1 && 'text' in o.parts[0] ? (o.parts[0] as { text: string }).text : content }
  ]
  const res = await fetch(`${OPENROUTER}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      'X-Title': 'KhmerDub Studio'
    },
    body: JSON.stringify({
      model: o.model,
      messages,
      temperature: o.temperature ?? 0.3,
      ...(o.schema || o.json ? { response_format: { type: 'json_object' } } : {})
    }),
    signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000)
  })
  if (!res.ok) throw new HttpError(res.status, `OpenRouter ${res.status}: ${await readError(res)}`)
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
  if (j.error) throw new Error(`OpenRouter: ${j.error.message}`)
  const text = j.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('OpenRouter returned no text')
  return text
}

/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const CLAUDE_FALLBACK_OK = /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-[12]|mythos-5-[12])$/
/** Older models reject output_config.effort. */
const CLAUDE_NO_EFFORT = /^claude-(haiku-4|sonnet-4-5|opus-4-[01]|3)/

type ClaudeImageType = Anthropic.Beta.BetaBase64ImageSource['media_type']

async function callClaude(key: string, o: LlmOptions): Promise<string> {
  // the app rotates keys itself (llmText), so no SDK-level retries
  const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 300_000 })
  const content: Anthropic.Beta.BetaContentBlockParam[] = o.parts.map((p) =>
    'text' in p
      ? { type: 'text', text: p.text }
      : { type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType as ClaudeImageType, data: p.inlineData.data } }
  )
  // Claude has no Gemini-style responseSchema here; callers parse with extractJson, so ask for bare JSON
  const system = [o.system, o.schema || o.json ? 'Reply with only valid JSON: no prose and no code fences.' : '']
    .filter(Boolean)
    .join('\n\n')
  try {
    // streaming avoids HTTP timeouts on long translation batches
    const msg = await client.beta.messages
      .stream(
        {
          model: o.model,
          max_tokens: 64000,
          ...(system ? { system } : {}),
          ...(CLAUDE_NO_EFFORT.test(o.model) ? {} : { output_config: { effort: 'medium' as const } }),
          // if Claude declines (safety classifier), the API retries on a fallback model inside the same call
          ...(CLAUDE_FALLBACK_OK.test(o.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          messages: [{ role: 'user', content }]
        },
        { signal: o.signal }
      )
      .finalMessage()
    if (msg.stop_reason === 'refusal') {
      const cat = msg.stop_details?.category
      throw new Error(`Claude declined this request${cat ? ` (${cat})` : ''}. Try Gemini for this text.`)
    }
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    if (!text) throw new Error(`Claude returned no text (stop_reason: ${msg.stop_reason})`)
    return text
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError) throw Object.assign(new Error('Canceled'), { name: 'AbortError' })
    if (e instanceof Anthropic.APIError && typeof e.status === 'number') throw new HttpError(e.status, `Claude ${e.status}: ${e.message}`)
    throw e
  }
}

/** A key/quota problem that no retry can fix — callers must not retry it. */
export class FatalLlmError extends Error {}

/** How long a 429 says to wait ("Please retry in 21h44m31.7s" or "retryDelay": "78271s"), or null. */
export function retryAfterMs(msg: string): number | null {
  const m = msg.match(/retry in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i)
  if (m && (m[1] || m[2] || m[3])) return Math.round(((Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)) * 1000)
  const d = msg.match(/"?retryDelay"?\s*:\s*"([\d.]+)s"/)
  return d ? Math.round(Number(d[1]) * 1000) : null
}

/** Text completion with key rotation: 429 → cool key (60 s, or as long as the API says) and try the next; invalid key → cool 10 min. */
export async function llmText(o: LlmOptions): Promise<string> {
  const keys = keyPool.all(o.provider).length
  const maxAttempts = Math.max(3, keys * 2 + 2)
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { key, waitMs } = keyPool.next(o.provider)
    if (waitMs > 0) await sleep(Math.min(waitMs, 65_000), o.signal)
    try {
      return o.provider === 'gemini'
        ? await callGemini(key.key, o)
        : o.provider === 'claude'
          ? await callClaude(key.key, o)
          : await callOpenRouter(key.key, o)
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError' && o.signal?.aborted) throw err
      lastErr = err
      if (err instanceof HttpError) {
        const badKey = err.status === 401 || err.status === 403 || (err.status === 400 && /api key/i.test(err.message))
        if (err.status === 429) {
          // daily quota: Google says "retry in 21h44m31s" — cool the key that long instead of 60 s
          keyPool.cool(key.id, Math.max(60_000, retryAfterMs(err.message) ?? 0))
          // every key out of quota for minutes or more → fail now instead of waiting it out
          if (keyPool.stats(o.provider).ready === 0 && keyPool.next(o.provider).waitMs > 120_000) {
            throw new FatalLlmError(`${err.message}\nAll your ${o.provider} keys are out of quota. Add another key in Settings → API Keys, or pick a different translator.`)
          }
        } else if (badKey) {
          keyPool.cool(key.id, 600_000)
          // every key of this provider rejected → fail now instead of waiting out the 10-min cooldown
          if (keyPool.stats(o.provider).ready === 0) throw new FatalLlmError(`${err.message}\nCheck the key in Settings → API Keys.`)
        } else if (err.status >= 500) await sleep(1500 * (attempt + 1), o.signal)
        else throw err // other 4xx: request problem, retrying won't help
      } else {
        await sleep(1000 * (attempt + 1), o.signal)
      }
    }
  }
  throw lastErr ?? new Error('LLM request failed')
}

export async function llmJson<T = unknown>(o: LlmOptions): Promise<T> {
  const text = await llmText({ ...o, json: true })
  return extractJson<T>(text)
}

/** Validate a key by listing models. Returns model ids on success. */
export async function testKey(provider: Provider, key: string): Promise<{ ok: boolean; detail: string; models?: string[] }> {
  try {
    if (provider === 'gemini') {
      const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return { ok: false, detail: await readError(res) }
      const j = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> }
      const models = (j.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
      return { ok: true, detail: `${models.length} models`, models }
    }
    if (provider === 'claude') {
      const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 })
      const models: string[] = []
      for await (const m of client.models.list()) models.push(m.id)
      return { ok: true, detail: `${models.length} models`, models }
    }
    const res = await fetch(`${OPENROUTER}/key`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return { ok: false, detail: await readError(res) }
    return { ok: true, detail: 'Key valid' }
  } catch (e) {
    return { ok: false, detail: (e as Error).message }
  }
}
