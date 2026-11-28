import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { binPath } from '../lib/paths'
import { aiWorker } from '../lib/python'
import { engineStatus } from './pysetup'

/** who reads the frames: an AI with a key, or the offline OCR engine on this PC */
export type ReaderKind = 'gemini' | 'claude' | 'codecraft' | 'offline'

interface OcrLine {
  text: string
  score: number
  box: [number, number, number, number]
}

/** Offline OCR (RapidOCR in the Python worker) for a list of image files. */
async function offlineRead(images: string[], ctx: JobCtx, span: [number, number]): Promise<Array<{ text: string; lines: OcrLine[] }>> {
  const st = await engineStatus().catch(() => ({}) as Record<string, boolean>)
  if (!st.ocr) throw new Error('The offline screen reader is not installed: open Settings → Engines and install “Offline screen reader (OCR)”. Or choose Gemini / Claude to read the screen.')
  const r = await aiWorker.job<{ results: Array<{ text: string; lines: OcrLine[] }> }>('ocr', { images, min_score: 0.5 }, ctx, span)
  return r.results
}

/** Subtitle band from offline OCR boxes: the text rows in the lower part that show up in at least 2 frames. */
export function bandFromBoxes(frames: OcrLine[][]): { top: number; bottom: number } | null {
  const rows = frames.flatMap((ls, fi) => ls.filter((l) => (l.box[1] + l.box[3]) / 2 > 0.45 && l.box[2] - l.box[0] > 0.05).map((l) => ({ fi, top: l.box[1], bottom: l.box[3] })))
  if (!rows.length) return null
  const frameCount = new Set(rows.map((r) => r.fi)).size
  if (frameCount < Math.min(2, frames.length)) return null
  const top = Math.min(...rows.map((r) => r.top))
  const bottom = Math.max(...rows.map((r) => r.bottom))
  const pad = 0.02
  return { top: Math.max(0, top - pad), bottom: Math.min(1, bottom + pad) }
}
import { maskChange, mergeReadings, planReads, refineWithScan, textMask, type ScanFrame } from '../../shared/ocrtiming'
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

/** A reader whose account can't be used right now (billing, sign-in, quota): skipped until this time. */
const accountDown = new Map<string, number>()
/** "CodeCraft 402: Billing verification failed", 401 / 403, quota, credit… — the account, not the request */
export const isAccountProblem = (msg: string) => /\b(401|402|403|429)\b|billing|payment|quota|insufficient|credit|balance|unauthori[sz]ed|forbidden|api key/i.test(msg)

/**
 * The AI call for reading the screen:
 *  • a Gemini model that can't take images → retried with a vision model;
 *  • another reader (CodeCraft / OpenRouter) whose ACCOUNT fails (billing, key, quota) → Gemini takes over
 *    (when there is a Gemini key), and that reader is skipped for the next 10 minutes.
 */
export function makeReader(geminiModel: string, log: (m: string) => void = () => {}): typeof rawLlmJson {
  const gemini = <T,>(o: Parameters<typeof rawLlmJson>[0]) => {
    let g = { ...o, provider: 'gemini' as const, model: o.provider === 'gemini' ? o.model : geminiModel || VISION_FALLBACK }
    if (g.model && noVision.has(g.model)) g = { ...g, model: VISION_FALLBACK }
    return rawLlmJson<T>(g).catch((e: Error) => {
      if (g.model !== VISION_FALLBACK && /modality|not enabled|image input/i.test(e.message)) {
        noVision.add(g.model ?? '')
        return rawLlmJson<T>({ ...g, model: VISION_FALLBACK })
      }
      throw e
    })
  }
  return (async <T,>(o: Parameters<typeof rawLlmJson>[0]): Promise<T> => {
    if (o.provider === 'gemini') return gemini<T>(o)
    const canFallBack = keyPool.has('gemini')
    if (canFallBack && (accountDown.get(o.provider) ?? 0) > Date.now()) return gemini<T>(o)
    try {
      return await rawLlmJson<T>(o)
    } catch (e) {
      const msg = (e as Error).message
      if (!canFallBack || !isAccountProblem(msg)) throw e
      accountDown.set(o.provider, Date.now() + 10 * 60_000)
      log(`${msg.split(/\r?\n/)[0]} — reading with Gemini instead`)
      return gemini<T>(o)
    }
  }) as typeof rawLlmJson
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
  provider?: ReaderKind
  model?: string
}

const SCAN_FPS = 10
const SCAN_W = 480
const SCAN_H = 64

/**
 * Pixel scan of the subtitle band at 10 fps: how much the "text pixels" changed from the previous frame.
 * Streams raw greyscale frames from ffmpeg (nothing kept in memory but the last mask).
 */
export function scanBand(videoPath: string, top: number, keep: number, signal?: AbortSignal): Promise<ScanFrame[]> {
  return scanBandFull(videoPath, top, keep, signal).then((r) => r.frames)
}

const POOL_W = 160
const POOL_H = 16
/** Text pixels that stayed text in two frames in a row (still subtitles; moving background drops out), pooled small. */
function pooledSteady(mask: Uint8Array, prev: Uint8Array | null): Uint8Array {
  const out = new Uint8Array(POOL_W * POOL_H)
  if (!prev) return out
  const fx = SCAN_W / POOL_W
  const fy = SCAN_H / POOL_H
  for (let y = 0; y < SCAN_H; y++)
    for (let x = 0; x < SCAN_W; x++) {
      const i = y * SCAN_W + x
      if (mask[i] & prev[i]) out[Math.floor(y / fy) * POOL_W + Math.floor(x / fx)] = 1
    }
  return out
}

/**
 * Pixel scan + a small "steady text" picture at every `sampleEvery` seconds (to tell which samples show the
 * same subtitle as the one before, so the AI does not read it twice).
 */
export function scanBandFull(videoPath: string, top: number, keep: number, signal?: AbortSignal, sampleEvery = 0): Promise<{ frames: ScanFrame[]; samples: Uint8Array[] }> {
  return new Promise((resolve, reject) => {
    const samples: Uint8Array[] = []
    const vf = `fps=${SCAN_FPS},crop=iw:ih*${keep.toFixed(3)}:0:ih*${top.toFixed(3)},scale=${SCAN_W}:${SCAN_H}:flags=area,format=gray`
    const child = spawn(binPath('ffmpeg').path, ['-hide_banner', '-nostdin', '-v', 'error', '-i', videoPath, '-an', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { windowsHide: true, signal })
    const size = SCAN_W * SCAN_H
    const out: ScanFrame[] = []
    let buf: Buffer = Buffer.alloc(0)
    let prev: Uint8Array | null = null
    let i = 0
    child.stdout.on('data', (chunk: Buffer) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
      while (buf.length >= size) {
        const mask = textMask(new Uint8Array(buf.buffer, buf.byteOffset, size), SCAN_W, SCAN_H)
        buf = buf.subarray(size)
        const c = prev ? maskChange(prev, mask) : { score: 0, union: 0 }
        const t = Math.round((i / SCAN_FPS) * 100) / 100
        out.push({ t, ...c })
        if (sampleEvery > 0) {
          const k = Math.round(t / sampleEvery)
          // the scan frame nearest to each sample time (sample k is at k * sampleEvery)
          if (Math.abs(t - k * sampleEvery) < 0.5 / SCAN_FPS + 1e-6 && !samples[k]) samples[k] = pooledSteady(mask, prev)
        }
        prev = mask
        i++
      }
    })
    let err = ''
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 || out.length ? resolve({ frames: out, samples }) : reject(new Error(`Pixel scan failed: ${err.trim().slice(-300)}`))))
  })
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
    // the pixel scan runs alongside the frame sampling: it gives exact timing AND tells which frames need the AI
    const scanning = scanBandFull(p.videoPath, top, keep, ctx.signal, interval).catch((e) => {
      ctx.log(`Timing scan skipped: ${(e as Error).message}`)
      return { frames: [] as ScanFrame[], samples: [] as Uint8Array[] }
    })
    ctx.progress(0, 'Sampling frames')
    const r = await runFfmpeg(
      ['-y', '-i', p.videoPath, '-vf', `fps=1/${interval},crop=iw:ih*${keep.toFixed(3)}:0:ih*${top.toFixed(3)},scale='min(960,iw)':-2`, '-q:v', '5', join(dir, 'f_%06d.jpg'), '-progress', 'pipe:1', '-nostats'],
      { durationSec: p.durationSec, signal: ctx.signal, onProgress: (pct) => ctx.progress(pct * 0.15, 'Sampling frames') }
    )
    if (r.code !== 0) throw ffFail('Frame sampling', r.stderr)
    const frames = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
    const times = frames.map((_, i) => Math.round(i * interval * 100) / 100)
    const reads = new Map<number, string>()
    ctx.progress(15, 'Finding the frames where the subtitle changes')
    const { frames: scan, samples } = await scanning
    // speed: only frames where the subtitle changed are read; repeats are filled in afterwards
    const plan = planReads(times, samples)
    const toRead = plan.send
    if (plan.skipping) ctx.log(`Reading ${toRead.length} of ${frames.length} frames (${plan.same.size} repeats skipped)`)
    const batches = chunk(toRead.map((i) => ({ f: frames[i], t: times[i] })), 24)

    let doneFrames = 0
    ctx.progress(15, `Reading ${toRead.length} frames${plan.skipping ? ` (of ${frames.length})` : ''}`)
    const provider = p.provider ?? 'gemini'
    if (provider === 'offline') {
      const res = await offlineRead(toRead.map((i) => join(dir, frames[i])), ctx, [15, 95])
      res.forEach((r, k) => reads.set(times[toRead[k]], (r.text ?? '').trim()))
    } else {
    const model = (provider === 'gemini' ? p.geminiModel : p.model) || p.geminiModel
    const llmJson = makeReader(p.geminiModel, ctx.log)
    await mapLimit(batches, llmParallelism(keyPool.all(provider === 'claude' || provider === 'codecraft' ? provider : 'gemini').length), async (batch) => {
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
      ctx.progress(15 + (80 * doneFrames) / Math.max(1, toRead.length), `Read ${doneFrames} of ${toRead.length} frames`)
    })
    }

    // the skipped frames: the same subtitle as the frame read before them
    for (const [i, from] of plan.same) reads.set(times[i], reads.get(times[from]) ?? '')

    // readings → lines (OCR noise and one-sample blinks merged), then snapped to the real frames
    ctx.progress(96, 'Matching the exact start / end of every line')
    const lines = refineWithScan(
      mergeReadings(times.map((t) => ({ t, text: reads.get(t) ?? '' })), interval),
      scan,
      interval,
      p.durationSec
    )
    const thumbOf = (t: number) => {
      if (!p.thumbs) return undefined
      const i = times.indexOf(t)
      return i < 0 ? undefined : `data:image/jpeg;base64,${readFileSync(join(dir, frames[i])).toString('base64')}`
    }
    const segs: Array<RawSeg & { thumb?: string }> = lines.map((l) => ({ start: l.start, end: l.end, text: l.text, thumb: thumbOf(l.firstT) }))
    return { segments: segs }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface OcrAreaPayload {
  videoPath: string
  durationSec: number
  geminiModel: string
  provider?: ReaderKind
  model?: string
  epDir: string
}

/** "Find it for me": look at a few full frames and return where the burned-in subtitles sit (fractions of frame height). */
export async function findSubtitleArea(p: OcrAreaPayload, ctx: JobCtx): Promise<{ top: number; bottom: number } | null> {
  const dir = join(p.epDir, 'ocr_area')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    const n = p.provider === 'offline' ? 10 : 6
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []
    const files: string[] = []
    for (let i = 0; i < n; i++) {
      ctx.throwIfCanceled()
      const t = Math.max(0, ((i + 0.5) / n) * (p.durationSec || 60))
      const out = join(dir, `a${i}.jpg`)
      const r = await runFfmpeg(['-y', '-ss', t.toFixed(2), '-i', p.videoPath, '-frames:v', '1', '-vf', "scale='min(720,iw)':-2", '-q:v', '5', out], { signal: ctx.signal })
      if (r.code !== 0) continue
      files.push(out)
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: readFileSync(out).toString('base64') } })
    }
    if (!parts.length) throw new Error('Could not sample frames from the video')
    if (p.provider === 'offline') return bandFromBoxes((await offlineRead(files, ctx, [20, 100])).map((r) => r.lines))
    parts.push({
      text:
        'These are frames from one video. Find the horizontal band where burned-in SUBTITLE text appears (not logos, watermarks or UI). ' +
        'Return ONLY JSON {"found": boolean, "top": number, "bottom": number} where top/bottom are fractions 0..1 of the frame height covering all subtitle text with a little margin.'
    })
    const provider = p.provider ?? 'gemini'
    const llmJson = makeReader(p.geminiModel, ctx.log)
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
