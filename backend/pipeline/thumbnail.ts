// AI Thumbnail: a click-worthy cover picture for an episode (or a short).
// 1) grab frames at the story's strongest moments, 2) Gemini image model ("Nano Banana") repaints them into a
// poster-style picture — or the frame itself is used, 3) the app burns the title in with libass, so Khmer text is
// always shaped correctly (image models still garble Khmer script).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { JobCtx } from '../queue'
import { keyPool } from '../lib/keys'
import { runFfmpeg } from '../lib/ffmpeg'
import { fontsDir } from '../lib/paths'
import { assColor } from '../../shared/captions'
import { ffFail } from './extract'
import { httpJson } from './genvideo'

/** Newest first: when Google retires / renames a model (404), the next one is tried. */
export const IMAGE_MODELS = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']
const API = 'https://generativelanguage.googleapis.com/v1beta'

export type ThumbAspect = '16:9' | '9:16'

export interface ThumbPayload {
  videoPath: string
  /** video length; used to spread the pictures when no times are given */
  durationSec?: number
  /** seconds in the video to take pictures from (the strongest moments) */
  times: number[]
  /** 'ai' = Gemini repaints the frames into a poster; 'frame' = use the video frame itself (free, offline) */
  mode: 'ai' | 'frame'
  aspect: ThumbAspect
  /** big text burned on the picture ('' = none) */
  title: string
  /** small label in a coloured box, e.g. "EP 01" ('' = none) */
  tag?: string
  /** title colour */
  color?: string
  /** ASS font family (bundled: Kantumruy Pro, Hanuman) */
  font?: string
  /** English description of the scene for the image model */
  scene?: string
  /** extra wish from the user (any language) */
  note?: string
  /** how many different pictures, 1–4 */
  count: number
  outDir: string
  /** file name without extension */
  name: string
  model?: string
}

export const thumbSize = (a: ThumbAspect) => (a === '9:16' ? { w: 1080, h: 1920 } : { w: 1280, h: 720 })

/** What the image model is asked for (no text: the title is added by the app). */
export function thumbPrompt(p: Pick<ThumbPayload, 'aspect' | 'scene' | 'note'>, variant: number, frames: number): string {
  return [
    p.aspect === '9:16'
      ? 'Create an eye-catching vertical cover image (9:16) for a TikTok / Reels / YouTube Shorts drama video.'
      : 'Create an eye-catching YouTube thumbnail (16:9) for a drama series episode.',
    frames
      ? `The ${frames} attached picture${frames > 1 ? 's are frames' : ' is a frame'} from the video: keep the SAME characters (faces, hair, clothes, age) and the same setting, so the thumbnail truly matches the video.`
      : '',
    p.scene ? `Show: ${p.scene}` : 'Show the most dramatic, emotional moment of the story.',
    p.note ? `Extra wish from the creator: ${p.note}` : '',
    'Style: cinematic poster, dramatic lighting, high contrast, rich vivid colours, sharp focus on faces with strong readable emotion, close-up / medium close-up composition, shallow depth of field, clean uncluttered background.',
    `Keep the main faces in the upper two thirds and the bottom third calmer and darker, because a big title will be placed there.`,
    'Do NOT draw any text, letters, subtitles, captions, logos, watermarks, frames or borders.',
    variant > 0 ? `Variation ${variant + 1}: use a clearly different composition, camera angle or moment than a plain copy of the first frame.` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Request body for the Interactions API (same API as AI Video; image output). */
export function imageBody(model: string, prompt: string, frames: Array<{ data: string; mime: string }>, aspect: ThumbAspect) {
  return {
    model,
    input: [{ type: 'text', text: prompt }, ...frames.map((f) => ({ type: 'image', mime_type: f.mime, data: f.data }))],
    response_format: { type: 'image', aspect_ratio: aspect, image_size: '2K' }
  }
}

type ImagePart = { data?: string; uri?: string; mime_type?: string }

/** The generated picture in an interaction: output_image, else an image block in the model's output steps (never the echoed input). */
export function findImage(x: unknown): ImagePart | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const out = o.output_image as ImagePart | undefined
  if (out && (typeof out.data === 'string' || typeof out.uri === 'string')) return out
  const scan = (v: unknown): ImagePart | null => {
    if (!v || typeof v !== 'object') return null
    if (Array.isArray(v)) {
      for (const it of v) {
        const hit = scan(it)
        if (hit) return hit
      }
      return null
    }
    const r = v as Record<string, unknown>
    if (r.type === 'image' && (typeof r.data === 'string' || typeof r.uri === 'string')) return r as ImagePart
    for (const [k, val] of Object.entries(r)) {
      if (k === 'input') continue
      const hit = scan(val)
      if (hit) return hit
    }
    return null
  }
  return scan(o.steps ?? o.outputs ?? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'input')))
}

export function imageError(status: number, body: unknown, model: string): string {
  const b = (body ?? {}) as { error?: { message?: string }; errors?: Array<{ message?: string }> }
  const msg = b.error?.message || b.errors?.map((e) => e.message).filter(Boolean).join('; ') || (typeof body === 'string' ? body.slice(0, 300) : '')
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) return `Gemini quota exceeded (429) for ${model}. AI thumbnails need a Gemini key with billing enabled — or use "Video frame". ${msg}`.trim()
  if (status === 403 || /billing|free tier|not available/i.test(msg)) return `This Gemini key can't use ${model} — it needs a paid (billing-enabled) Google AI Studio project. Or use "Video frame". ${msg}`.trim()
  if (/safety|blocked|policy|prohibited/i.test(msg)) return `Google's safety filter blocked this picture. Try other moments or a different wish. ${msg}`.trim()
  return `AI thumbnail failed${status ? ` (HTTP ${status})` : ''}: ${msg || 'no picture in the answer'}`
}

/** ASS with the title (big, outlined, bottom) and an optional tag (coloured box, top left). Rendered over the picture by libass. */
export function thumbAss(o: { title: string; tag?: string; color?: string; font?: string }, w: number, h: number): string {
  const font = o.font || 'Kantumruy Pro'
  const short = Math.min(w, h)
  const len = [...o.title].length
  // shrink long titles so they fit in two or three lines
  const size = Math.round(short * (len > 40 ? 0.085 : len > 24 ? 0.11 : len > 12 ? 0.13 : 0.16))
  const tagSize = Math.round(short * 0.055)
  const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N').trim()
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Title,${font},${size},${assColor(o.color || '#FFD400')},${assColor('#FFFFFF')},${assColor('#000000')},${assColor('#000000', 0.6)},-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(size * 0.11))},${Math.max(2, Math.round(size * 0.07))},2,${Math.round(w * 0.05)},${Math.round(w * 0.05)},${Math.round(h * 0.06)},1`,
    `Style: Tag,${font},${tagSize},${assColor('#FFFFFF')},${assColor('#FFFFFF')},${assColor('#E11D48')},${assColor('#000000', 0.4)},-1,0,0,0,100,100,0,0,3,${Math.round(tagSize * 0.35)},0,7,${Math.round(short * 0.045)},${Math.round(short * 0.045)},${Math.round(short * 0.045)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  if (esc(o.title)) lines.push(`Dialogue: 1,0:00:00.00,0:00:10.00,Title,,0,0,0,,${esc(o.title)}`)
  if (o.tag && esc(o.tag)) lines.push(`Dialogue: 2,0:00:00.00,0:00:10.00,Tag,,0,0,0,,${esc(o.tag)}`)
  return lines.join('\n') + '\n'
}

const safeName = (s: string) => (s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'thumbnail').replace(/[. ]+$/, '')

async function grabFrame(video: string, t: number, out: string, signal: AbortSignal) {
  const r = await runFfmpeg(['-y', '-ss', Math.max(0, t).toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', out], { signal })
  if (r.code !== 0 || !existsSync(out)) throw ffFail('Taking a picture from the video', r.stderr)
}

/** One picture from the image model; tries every Gemini key (quota / billing) and the next model when one is gone (404). */
async function paint(p: ThumbPayload, prompt: string, frames: Array<{ data: string; mime: string }>, ctx: JobCtx, label: string): Promise<Buffer> {
  const models = p.model ? [p.model] : IMAGE_MODELS
  const first = keyPool.next('gemini').key // throws "No Gemini API key…" when there is none
  const keys = [first, ...keyPool.all('gemini').filter((k) => k.id !== first.id)]
  let lastErr = ''
  for (const model of models) {
    let r: Awaited<ReturnType<typeof httpJson>> | undefined
    let key = keys[0]
    for (const k of keys) {
      key = k
      r = await httpJson('POST', `${API}/interactions`, k.key, imageBody(model, prompt, frames, p.aspect), ctx.signal)
      if (r.status !== 429 && r.status !== 403) break
      if (r.status === 429) keyPool.cool(k.id)
      ctx.log(`${label}: Gemini key ${k.id} HTTP ${r.status}, trying the next key`)
    }
    if (!r) break
    if (r.status === 404 || (r.status === 400 && /model|not found|unsupported/i.test(r.text))) {
      lastErr = imageError(r.status, r.json ?? r.text, model)
      ctx.log(`${label}: ${model} unavailable (HTTP ${r.status}), trying the next model`)
      continue
    }
    if (r.status >= 400) throw new Error(imageError(r.status, r.json ?? r.text, model))
    let interaction = r.json
    for (let i = 0; i < 60; i++) {
      const it = interaction as { id?: string; status?: string }
      if (findImage(interaction) || !it?.id || !['in_progress', 'requires_continuation'].includes(it.status ?? '')) break
      await new Promise((res) => setTimeout(res, 3000))
      ctx.throwIfCanceled()
      const g = await httpJson('GET', `${API}/interactions/${encodeURIComponent(it.id)}`, key.key, undefined, ctx.signal)
      if (g.status >= 400) throw new Error(imageError(g.status, g.json ?? g.text, model))
      interaction = g.json
    }
    const img = findImage(interaction)
    if (!img) throw new Error(imageError(0, interaction, model))
    if (img.data) return Buffer.from(img.data, 'base64')
    const url = /^https?:/.test(img.uri!) ? img.uri! : `${API}/${img.uri!.replace(/^\//, '')}:download?alt=media`
    const res = await fetch(url, { headers: { 'x-goog-api-key': key.key }, redirect: 'follow', signal: ctx.signal })
    if (!res.ok) throw new Error(`Downloading the AI picture failed (HTTP ${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  }
  throw new Error(lastErr || 'No Gemini image model is available')
}

export async function makeThumbnails(p: ThumbPayload, ctx: JobCtx): Promise<{ files: string[]; clean: string[] }> {
  if (!existsSync(p.videoPath)) throw new Error('Video file not found')
  const count = Math.max(1, Math.min(4, Math.round(p.count || 1)))
  const times = (p.times.length ? p.times : [0.2, 0.4, 0.6, 0.8].map((x) => x * (p.durationSec || 10))).slice(0, 6)
  const { w, h } = thumbSize(p.aspect)
  const work = join(tmpdir(), `kd-thumb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  mkdirSync(join(work, 'fonts'), { recursive: true })
  if (existsSync(fontsDir)) for (const f of readdirSync(fontsDir)) if (/\.(ttf|otf)$/i.test(f)) copyFileSync(join(fontsDir, f), join(work, 'fonts', f))
  try {
    // 1) pictures from the video
    ctx.progress(3, 'Taking pictures from the video')
    const frames: string[] = []
    for (const [i, t] of times.entries()) {
      ctx.throwIfCanceled()
      const f = join(work, `frame${i}.jpg`)
      await grabFrame(p.videoPath, t, f, ctx.signal)
      frames.push(f)
    }
    const b64 = frames.map((f) => ({ data: readFileSync(f).toString('base64'), mime: 'image/jpeg' }))

    // 2) backgrounds: the AI poster, or the frame itself
    const bgs: string[] = []
    for (let i = 0; i < count; i++) {
      ctx.throwIfCanceled()
      if (p.mode === 'frame') {
        bgs.push(frames[i % frames.length])
        continue
      }
      const label = count > 1 ? `Picture ${i + 1} of ${count}` : 'Picture'
      ctx.progress(8 + (80 * i) / count, `${label}: painting with Gemini…`)
      // each variation leads with a different moment, plus up to 2 more for the faces
      const refs = [0, 1, 2].map((k) => b64[(i + k) % b64.length]).filter((v, k, a) => a.indexOf(v) === k)
      const bytes = await paint(p, thumbPrompt(p, i, refs.length), refs, ctx, label)
      if (bytes.length < 1000) throw new Error('The AI picture was empty')
      const f = join(work, `bg${i}.png`)
      writeFileSync(f, bytes)
      bgs.push(f)
    }

    // 3) fill the frame, darken the bottom, burn the title
    ctx.progress(90, 'Adding the title')
    writeFileSync(join(work, 'title.ass'), thumbAss(p, w, h), 'utf8')
    mkdirSync(p.outDir, { recursive: true })
    const base = safeName(p.name)
    const files: string[] = []
    const clean: string[] = []
    for (const [i, bg] of bgs.entries()) {
      let out = join(p.outDir, `${base}${count > 1 ? ` ${i + 1}` : ''}.jpg`)
      for (let k = 2; existsSync(out); k++) out = join(p.outDir, `${base}${count > 1 ? ` ${i + 1}` : ''} (${k}).jpg`)
      const fill = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1${p.mode === 'frame' ? ',eq=contrast=1.08:saturation=1.18' : ''}`
      const hasText = !!(p.title.trim() || p.tag?.trim())
      const graph = hasText
        ? [
            `[0:v]${fill},format=rgba[bg]`,
            // bottom shade so the title reads on any picture
            `color=c=black:s=${w}x${h}:d=1,format=rgba,geq=r=0:g=0:b=0:a='if(gt(Y,H*0.45),210*pow((Y-H*0.45)/(H*0.55),1.2),0)'[sh]`,
            `[bg][sh]overlay=format=auto,subtitles=title.ass:fontsdir=fonts,format=yuvj420p[v]`
          ]
        : [`[0:v]${fill},format=yuvj420p[v]`]
      writeFileSync(join(work, 'graph.txt'), graph.join(';\n'), 'utf8')
      const r = await runFfmpeg(['-y', '-i', bg, '-/filter_complex', 'graph.txt', '-map', '[v]', '-frames:v', '1', '-q:v', '2', out], { cwd: work, signal: ctx.signal })
      if (r.code !== 0 || !existsSync(out)) throw ffFail('Making the thumbnail', r.stderr)
      files.push(out)
      // the picture without text, for editing in Canva / Photoshop
      if (hasText) {
        const c = out.replace(/\.jpg$/, ' (no text).jpg')
        const r2 = await runFfmpeg(['-y', '-i', bg, '-vf', `${fill},format=yuvj420p`, '-frames:v', '1', '-q:v', '2', c], { signal: ctx.signal })
        if (r2.code === 0) clean.push(c)
      }
    }
    ctx.progress(100, `${files.length} thumbnail${files.length > 1 ? 's' : ''} ready`)
    return { files, clean }
  } finally {
    try {
      rmSync(work, { recursive: true, force: true })
    } catch {
      /* in use */
    }
  }
}
