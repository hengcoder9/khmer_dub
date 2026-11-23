import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chunk } from '../../shared/translate'
import { runFfmpeg } from '../lib/ffmpeg'
import { llmJson as rawLlmJson } from '../lib/llm'
import { ffFail } from './extract'
import type { JobCtx } from '../queue'
import { keyPool } from '../lib/keys'
import { llmParallelism, mapLimit } from '../../shared/parallel'
import type { RawSeg } from '../../shared/segments'

/** Gemini model known to read images; used when the chosen model is text-only ("Image input modality is not enabled"). */
const VISION_FALLBACK = 'gemini-3.8-flash'
const noVision = new Set<string>()

/** Like llmJson, but if the chosen Gemini model can't take images, retry once with a vision-capable model. */
const llmJson: typeof rawLlmJson = async (o) => {
  const model = o.model
  if (o.provider === 'gemini' && model && noVision.has(model)) o = { ...o, model: VISION_FALLBACK }
  try {
    return await rawLlmJson(o)
  } catch (e) {
    if (o.provider === 'gemini' && o.model !== VISION_FALLBACK && /modality|not enabled|image input/i.test((e as Error).message)) {
      noVision.add(o.model ?? '')
      return rawLlmJson({ ...o, model: VISION_FALLBACK })
    }
    throw e
  }
}

export interface OcrPayload {
  videoPath: string
  epDir: string
  durationSec: number
  interval: number // seconds between sampled frames
  cropTop: number // 0..1, keep the bottom part from this fraction (subtitles area)
  /** exact subtitle band as fractions of the frame height (overrides cropTop) */
  region?: { top: number; bottom: number }
  /** attach a small picture of each line (for the review list) */
  thumbs?: boolean
  geminiModel: string
  /** which AI reads the frames (default Gemini) */
  provider?: 'gemini' | 'codecraft'
  model?: string
}

/** "Read Screen": sample frames, read hard-coded subtitles with Gemini vision, merge into timed lines. */
export async function readScreen(p: OcrPayload, ctx: JobCtx): Promise<{ segments: Array<RawSeg & { thumb?: string }> }> {
  const dir = join(p.epDir, 'ocr_frames')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const interval = Math.max(0.25, p.interval)
  const top = Math.max(0, Math.min(0.95, p.region ? p.region.top : p.cropTop))
  const bottom = p.region ? Math.max(top + 0.03, Math.min(1, p.region.bottom)) : 1
  const keep = bottom - top
  try {
    ctx.progress(0, 'Sampling frames')
    const r = await runFfmpeg(
      ['-y', '-i', p.videoPath, '-vf', `fps=1/${interval},crop=iw:ih*${keep.toFixed(3)}:0:ih*${top.toFixed(3)},scale='min(960,iw)':-2`, '-q:v', '5', join(dir, 'f_%06d.jpg'), '-progress', 'pipe:1', '-nostats'],
      { durationSec: p.durationSec, signal: ctx.signal, onProgress: (pct) => ctx.progress(pct * 0.15, 'Sampling frames') }
    )
    if (r.code !== 0) throw ffFail('Frame sampling', r.stderr)
    const frames = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
    const times = frames.map((_, i) => Math.round(i * interval * 100) / 100)
    const reads = new Map<number, string>()
    const batches = chunk(frames.map((f, i) => ({ f, t: times[i] })), 24)

    let doneFrames = 0
    ctx.progress(15, `Reading ${frames.length} frames`)
    const provider = p.provider ?? 'gemini'
    const model = (provider === 'gemini' ? p.geminiModel : p.model) || p.geminiModel
    await mapLimit(batches, llmParallelism(keyPool.all(provider).length), async (batch) => {
      ctx.throwIfCanceled()
      const parts = batch.flatMap(({ f, t }) => [
        { text: `Frame t=${t}` },
        { inlineData: { mimeType: 'image/jpeg', data: readFileSync(join(dir, f)).toString('base64') } }
      ])
      parts.push({
        text:
          'Each image is the bottom part of a video frame. Read the burned-in SUBTITLE text exactly as shown (keep the original language and line breaks as spaces). ' +
          'Ignore logos, watermarks, channel names and UI. If a frame has no subtitle, use "". Return ONLY JSON: [{"t": number, "text": string}] for every frame.'
      })
      const rows = await llmJson<Array<{ t: number; text: string }>>({
        provider,
        model,
        parts,
        schema: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { t: { type: 'NUMBER' }, text: { type: 'STRING' } }, required: ['t', 'text'] }
        },
        temperature: 0,
        signal: ctx.signal
      })
      for (const row of rows) reads.set(Number(row.t), (row.text ?? '').trim())
      doneFrames += batch.length
      ctx.progress(15 + (80 * doneFrames) / frames.length, `Read ${doneFrames} of ${frames.length} frames`)
    })

    // merge consecutive identical readings into segments
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
    const segs: Array<RawSeg & { thumb?: string }> = []
    let cur: (RawSeg & { thumb?: string }) | null = null
    const thumbOf = (t: number) => {
      if (!p.thumbs) return undefined
      const i = times.indexOf(t)
      return i < 0 ? undefined : `data:image/jpeg;base64,${readFileSync(join(dir, frames[i])).toString('base64')}`
    }
    for (const t of times) {
      const text = norm(reads.get(t) ?? '')
      if (cur && text && norm(cur.text) === text) {
        cur.end = Math.min(p.durationSec || t + interval, t + interval)
        continue
      }
      if (cur) segs.push(cur)
      cur = text ? { start: t, end: Math.min(p.durationSec || t + interval, t + interval), text, thumb: thumbOf(t) } : null
    }
    if (cur) segs.push(cur)
    return { segments: segs.filter((s) => s.end - s.start >= Math.min(0.5, interval)) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface OcrAreaPayload {
  videoPath: string
  durationSec: number
  geminiModel: string
  provider?: 'gemini' | 'codecraft'
  model?: string
  epDir: string
}

/** "Find it for me": look at a few full frames and return where the burned-in subtitles sit (fractions of frame height). */
export async function findSubtitleArea(p: OcrAreaPayload, ctx: JobCtx): Promise<{ top: number; bottom: number } | null> {
  const dir = join(p.epDir, 'ocr_area')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    const n = 6
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []
    for (let i = 0; i < n; i++) {
      ctx.throwIfCanceled()
      const t = Math.max(0, ((i + 0.5) / n) * (p.durationSec || 60))
      const out = join(dir, `a${i}.jpg`)
      const r = await runFfmpeg(['-y', '-ss', t.toFixed(2), '-i', p.videoPath, '-frames:v', '1', '-vf', "scale='min(720,iw)':-2", '-q:v', '5', out], { signal: ctx.signal })
      if (r.code !== 0) continue
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: readFileSync(out).toString('base64') } })
    }
    if (!parts.length) throw new Error('Could not sample frames from the video')
    parts.push({
      text:
        'These are frames from one video. Find the horizontal band where burned-in SUBTITLE text appears (not logos, watermarks or UI). ' +
        'Return ONLY JSON {"found": boolean, "top": number, "bottom": number} where top/bottom are fractions 0..1 of the frame height covering all subtitle text with a little margin.'
    })
    const provider = p.provider ?? 'gemini'
    const r = await llmJson<{ found: boolean; top: number; bottom: number }>({
      provider,
      model: (provider === 'gemini' ? p.geminiModel : p.model) || p.geminiModel,
      parts,
      schema: { type: 'OBJECT', properties: { found: { type: 'BOOLEAN' }, top: { type: 'NUMBER' }, bottom: { type: 'NUMBER' } }, required: ['found', 'top', 'bottom'] },
      temperature: 0,
      signal: ctx.signal
    })
    if (!r.found || !(r.bottom > r.top)) return null
    return { top: Math.max(0, Math.min(0.95, r.top)), bottom: Math.max(0.05, Math.min(1, r.bottom)) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
