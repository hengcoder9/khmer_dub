// "AI Video from prompt": text (+ optional image) → video with Google Gemini Omni (gemini-omni-1.2-flash).
// Veo was shut down on the Gemini API (Oct 2026); Omni replaces it via the Interactions API. Paid Gemini tier only.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { request } from 'node:https'
import { extname, join } from 'node:path'
import type { JobCtx } from '../queue'
import { keyPool } from '../lib/keys'

export const OMNI_MODEL = 'gemini-omni-1.2-flash'
const API = 'https://generativelanguage.googleapis.com/v1beta'

export interface GenVideoPayload {
  prompt: string
  aspect: '9:16' | '16:9'
  resolution: '360p' | '720p' | '1080p'
  /** whole seconds, 3–15 */
  seconds: number
  /** optional reference image (jpg / png) */
  imagePath?: string
  outDir: string
  /** file name without extension */
  name: string
  model?: string
}

/** Request body for the Interactions API (fields from the Omni docs). */
export function omniBody(p: Pick<GenVideoPayload, 'prompt' | 'aspect' | 'resolution' | 'seconds'> & { image?: { data: string; mime: string }; model?: string }) {
  const seconds = Math.max(3, Math.min(15, Math.round(p.seconds)))
  return {
    model: p.model || OMNI_MODEL,
    input: p.image
      ? [
          { type: 'image', data: p.image.data, mime_type: p.image.mime },
          { type: 'text', text: p.prompt }
        ]
      : p.prompt,
    response_format: { type: 'video', aspect_ratio: p.aspect, resolution: p.resolution, duration: `${seconds}s` }
  }
}

type VideoPart = { data?: string; uri?: string; mime_type?: string }

/** Find the generated video anywhere in an interaction (steps[].content[] with type "video"; tolerant of shape changes). */
export function findVideo(x: unknown): VideoPart | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  if (o.type === 'video' && (typeof o.data === 'string' || typeof o.uri === 'string')) return o as VideoPart
  for (const v of Object.values(o)) {
    const hit = Array.isArray(v) ? v.map(findVideo).find(Boolean) : findVideo(v)
    if (hit) return hit
  }
  return null
}

/** Human message for a failed / blocked interaction or HTTP error body. */
export function omniError(status: number, body: unknown): string {
  const b = (body ?? {}) as { error?: { message?: string; status?: string }; errors?: Array<{ message?: string }>; status?: string }
  const msg = b.error?.message || b.errors?.map((e) => e.message).filter(Boolean).join('; ') || (typeof body === 'string' ? body.slice(0, 300) : '')
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) return `Gemini quota exceeded (429). AI Video needs a Gemini key with billing enabled (paid tier). ${msg}`.trim()
  if (status === 403 || /billing|free tier|not available/i.test(msg)) return `This Gemini key can't use ${OMNI_MODEL} — it needs a paid (billing-enabled) Google AI Studio project. ${msg}`.trim()
  if (status === 404) return `Video model not found (${OMNI_MODEL}). Google may have renamed it. ${msg}`.trim()
  if (/safety|blocked|policy/i.test(msg)) return `The prompt or video was blocked by Google's safety filters. Try different wording. ${msg}`.trim()
  return `AI Video failed${status ? ` (HTTP ${status})` : ''}: ${msg || 'no details'}`
}

/** HTTPS JSON call without client timeouts (a synchronous video generation can take minutes). */
export function httpJson(method: 'GET' | 'POST', url: string, key: string, body: unknown, signal: AbortSignal): Promise<{ status: number; json: unknown; text: string }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = request(
      url,
      { method, signal, headers: { 'x-goog-api-key': key, ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json: unknown = undefined
          try {
            json = JSON.parse(text)
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, json, text })
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function download(uri: string, key: string, signal: AbortSignal): Promise<Buffer> {
  // a Files API resource name ("files/abc") or a full URL; Files downloads need ":download?alt=media"
  const url = /^https?:/.test(uri) ? uri : `${API}/${uri.replace(/^\//, '')}:download?alt=media`
  const res = await fetch(url, { headers: { 'x-goog-api-key': key }, redirect: 'follow', signal })
  if (!res.ok) throw new Error(`Downloading the generated video failed (HTTP ${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new Error('Canceled'))), { once: true })
  })

export async function genVideo(p: GenVideoPayload, ctx: JobCtx): Promise<{ path: string; model: string }> {
  if (!p.prompt.trim()) throw new Error('Write a prompt first')
  let image: { data: string; mime: string } | undefined
  if (p.imagePath) {
    if (!existsSync(p.imagePath)) throw new Error('Reference image not found')
    const ext = extname(p.imagePath).toLowerCase()
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) throw new Error('Reference image must be JPG or PNG')
    image = { data: readFileSync(p.imagePath).toString('base64'), mime: ext === '.png' ? 'image/png' : 'image/jpeg' }
  }
  const body = omniBody({ ...p, image })
  // every Gemini key, starting with the next in rotation: a key out of quota (429) or without billing (403) → try the next.
  // next() throws "No Gemini API key…" when there is none.
  const first = keyPool.next('gemini').key
  const keys = [first, ...keyPool.all('gemini').filter((k) => k.id !== first.id)]
  ctx.progress(3, `Generating ${body.response_format.duration} ${p.aspect} video with ${body.model}…`)
  const started = Date.now()
  const tick = setInterval(() => ctx.progress(Math.min(90, 3 + (Date.now() - started) / 2000), `Generating… ${Math.round((Date.now() - started) / 1000)} s`), 2000)
  let interaction: unknown
  let key = keys[0]
  try {
    let r: Awaited<ReturnType<typeof httpJson>> | undefined
    for (const k of keys) {
      key = k
      r = await httpJson('POST', `${API}/interactions`, k.key, body, ctx.signal)
      if (r.status !== 429 && r.status !== 403) break
      if (r.status === 429) keyPool.cool(k.id)
      ctx.log(`Gemini key ${k.id}: HTTP ${r.status}, trying the next key`)
    }
    if (!r || r.status >= 400) throw new Error(omniError(r?.status ?? 0, r?.json ?? r?.text))
    interaction = r.json
    // if the API answers before the video is ready, poll the interaction
    for (let i = 0; i < 180; i++) {
      const it = interaction as { id?: string; status?: string }
      if (findVideo(interaction) || !it?.id || !['in_progress', 'requires_continuation'].includes(it.status ?? '')) break
      await sleep(5000, ctx.signal)
      const g = await httpJson('GET', `${API}/interactions/${encodeURIComponent(it.id)}`, key.key, undefined, ctx.signal)
      if (g.status >= 400) throw new Error(omniError(g.status, g.json ?? g.text))
      interaction = g.json
    }
  } finally {
    clearInterval(tick)
  }
  const st = (interaction as { status?: string })?.status
  if (st && ['failed', 'cancelled', 'incomplete'].includes(st)) throw new Error(omniError(0, interaction))
  const video = findVideo(interaction)
  if (!video) throw new Error(omniError(0, interaction) + ' (no video in the response)')
  ctx.progress(93, 'Saving video')
  const bytes = video.data ? Buffer.from(video.data, 'base64') : await download(video.uri!, key.key, ctx.signal)
  if (bytes.length < 1000) throw new Error('The generated video was empty')
  mkdirSync(p.outDir, { recursive: true })
  const safe = (p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'ai-video').replace(/[. ]+$/, '')
  let path = join(p.outDir, `${safe}.mp4`)
  for (let i = 2; existsSync(path); i++) path = join(p.outDir, `${safe} (${i}).mp4`)
  writeFileSync(path, bytes)
  ctx.progress(100, `Saved ${(bytes.length / 1048576).toFixed(1)} MB`)
  return { path, model: body.model }
}
