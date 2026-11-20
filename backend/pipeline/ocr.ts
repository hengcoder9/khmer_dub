import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chunk } from '../../shared/translate'
import { runFfmpeg } from '../lib/ffmpeg'
import { llmJson } from '../lib/llm'
import { ffFail } from './extract'
import type { JobCtx } from '../queue'
import { keyPool } from '../lib/keys'
import { llmParallelism, mapLimit } from '../../shared/parallel'
import type { RawSeg } from '../../shared/segments'

export interface OcrPayload {
  videoPath: string
  epDir: string
  durationSec: number
  interval: number // seconds between sampled frames
  cropTop: number // 0..1, keep the bottom part from this fraction (subtitles area)
  geminiModel: string
}

/** "Read Screen": sample frames, read hard-coded subtitles with Gemini vision, merge into timed lines. */
export async function readScreen(p: OcrPayload, ctx: JobCtx): Promise<{ segments: RawSeg[] }> {
  const dir = join(p.epDir, 'ocr_frames')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const interval = Math.max(0.25, p.interval)
  const top = Math.max(0, Math.min(0.9, p.cropTop))
  try {
    ctx.progress(0, 'Sampling frames')
    const r = await runFfmpeg(
      ['-y', '-i', p.videoPath, '-vf', `fps=1/${interval},crop=iw:ih*${(1 - top).toFixed(3)}:0:ih*${top.toFixed(3)},scale='min(960,iw)':-2`, '-q:v', '5', join(dir, 'f_%06d.jpg'), '-progress', 'pipe:1', '-nostats'],
      { durationSec: p.durationSec, signal: ctx.signal, onProgress: (pct) => ctx.progress(pct * 0.15, 'Sampling frames') }
    )
    if (r.code !== 0) throw ffFail('Frame sampling', r.stderr)
    const frames = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
    const times = frames.map((_, i) => Math.round(i * interval * 100) / 100)
    const reads = new Map<number, string>()
    const batches = chunk(frames.map((f, i) => ({ f, t: times[i] })), 24)

    let doneFrames = 0
    ctx.progress(15, `Reading ${frames.length} frames`)
    await mapLimit(batches, llmParallelism(keyPool.all('gemini').length), async (batch) => {
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
        provider: 'gemini',
        model: p.geminiModel,
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
    const segs: RawSeg[] = []
    let cur: RawSeg | null = null
    for (const t of times) {
      const text = norm(reads.get(t) ?? '')
      if (cur && text && norm(cur.text) === text) {
        cur.end = Math.min(p.durationSec || t + interval, t + interval)
        continue
      }
      if (cur) segs.push(cur)
      cur = text ? { start: t, end: Math.min(p.durationSec || t + interval, t + interval), text } : null
    }
    if (cur) segs.push(cur)
    return { segments: segs.filter((s) => s.end - s.start >= Math.min(0.5, interval)) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
