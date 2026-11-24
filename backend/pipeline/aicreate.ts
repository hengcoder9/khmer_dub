// AI Creator: shorts, trailer / recap and upload text (title, description, hashtags) from a timestamped transcript.
// The LLM proposes; the user reviews and exports. Times are SOURCE seconds.

import { llmJson } from '../lib/llm'
import type { Provider } from '../lib/keys'
import { langName } from '../../shared/translate'

export interface CreatorLine {
  start: number
  end: number
  text: string
  speaker?: string
}

export interface UploadMeta {
  title: string
  description: string
  hashtags: string[]
}

export interface CreatorItem extends UploadMeta {
  hook: string
  keep: Array<{ start: number; end: number }>
}

export interface CreatorRequest {
  mode: 'shorts' | 'trailer' | 'recap'
  provider: Provider
  model: string
  durationSec: number
  lines: CreatorLine[]
  /** shorts: how many; trailer/recap: always 1 */
  count?: number
  /** target length of each video in seconds */
  seconds: number
  /** language for title / description / hashtags */
  metaLang: string
  /** project / series name, for titles and hashtags */
  series?: string
  episode?: string
  /** optional extra instruction from the user */
  note?: string
}

const r2 = (n: number) => Math.round(n * 100) / 100

const META_PROPS = {
  title: { type: 'STRING' },
  description: { type: 'STRING' },
  hashtags: { type: 'ARRAY', items: { type: 'STRING' } }
}
const ITEM = {
  type: 'OBJECT',
  properties: {
    ...META_PROPS,
    hook: { type: 'STRING' },
    keep: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { start: { type: 'NUMBER' }, end: { type: 'NUMBER' } }, required: ['start', 'end'] }
    }
  },
  required: ['title', 'keep']
}
const ITEMS_SCHEMA = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: ITEM } }, required: ['items'] }
const META_SCHEMA = { type: 'OBJECT', properties: META_PROPS, required: ['title', 'description', 'hashtags'] }

const transcriptText = (lines: CreatorLine[]) =>
  lines.map((l) => `${r2(l.start)}–${r2(l.end)}${l.speaker ? ` ${l.speaker}` : ''}: ${l.text}`).join('\n')

const metaRules = (lang: string) =>
  [
    `Write "title", "description" and "hashtags" in ${langName(lang)}.`,
    'title: catchy, under 70 characters, no clickbait lies, no emojis at the start.',
    'description: 1–3 short sentences that make people want to watch, without spoiling the ending.',
    'hashtags: 5–10 tags without spaces, starting with "#", mixing the series/genre with popular general tags.'
  ].join('\n')

/** Clean the hashtags: one "#", no spaces, no duplicates. */
export function cleanTags(tags: unknown): string[] {
  const out: string[] = []
  for (const t of Array.isArray(tags) ? tags : []) {
    const s = String(t).trim().replace(/^#+/, '').replace(/\s+/g, '')
    if (s && !out.some((x) => x.toLowerCase() === `#${s}`.toLowerCase())) out.push(`#${s}`)
  }
  return out.slice(0, 15)
}

/**
 * Keep ranges inside the video, in order, merged when they touch, and trimmed so the total is at most
 * `maxSec` (the AI tends to overshoot the target length).
 */
export function cleanKeep(keep: unknown, durationSec: number, maxSec: number): Array<{ start: number; end: number }> {
  const list = (Array.isArray(keep) ? keep : [])
    .map((k: any) => ({ start: Math.max(0, r2(Number(k?.start))), end: Math.min(durationSec, r2(Number(k?.end))) }))
    .filter((k) => Number.isFinite(k.start) && Number.isFinite(k.end) && k.end - k.start >= 0.5)
  const out: Array<{ start: number; end: number }> = []
  let total = 0
  for (const k of list) {
    if (total >= maxSec) break
    const len = Math.min(k.end - k.start, maxSec - total)
    if (len < 0.5) break
    out.push({ start: k.start, end: r2(k.start + len) })
    total += len
  }
  return out
}

export async function planCreate(req: CreatorRequest): Promise<{ items: CreatorItem[] }> {
  if (!req.lines.length) throw new Error('This episode has no lines yet — make the lines first (Listen + Read) so the AI can read the story.')
  const count = req.mode === 'shorts' ? Math.max(1, Math.min(10, Math.round(req.count ?? 3))) : 1
  const sec = Math.max(10, Math.min(180, req.seconds))
  const task =
    req.mode === 'shorts'
      ? [
          `Make ${count} separate vertical SHORTS (TikTok / Reels / YouTube Shorts), each about ${sec} seconds (never more than ${Math.round(sec * 1.15)}).`,
          'Each short must stand on its own: pick a different strong moment (conflict, reveal, emotion, funny beat), no overlap between shorts.',
          'Start each short with its most gripping line (the hook) — you may put a hook range first and then the build-up.',
          'Prefer one continuous range; use 2–4 ranges only to cut dead air inside the moment.'
        ]
      : req.mode === 'trailer'
        ? [
            `Make one TRAILER / teaser of about ${sec} seconds that makes people want to watch the full episode.`,
            'Use 4–10 short ranges from across the episode: the hook first, rising tension, and end on a cliffhanger line. Do not reveal the ending.'
          ]
        : [
            `Make one RECAP ("previously on…") of about ${sec} seconds that tells the main story of this episode in order.`,
            'Use 5–12 ranges in story order, covering the key events and the ending, so a viewer of the next episode is caught up.'
          ]
  const system = [
    'You are a top short-form video editor for drama series, working from a timestamped transcript.',
    'Times are SOURCE seconds. "keep" lists the ranges to play, in playback order.',
    'Cut only on line boundaries (use the given start/end times) so words are never chopped.',
    ...task,
    '"hook": the on-screen hook text for the first seconds (max 8 words), in the same language as title.',
    metaRules(req.metaLang),
    'Return JSON: { "items": [ { "title", "description", "hashtags", "hook", "keep": [{ "start", "end" }] } ] }.'
  ].join('\n')
  const user = [
    req.series ? `Series: ${req.series}${req.episode ? `, episode ${req.episode}` : ''}` : '',
    `Video duration: ${r2(req.durationSec)} s.`,
    req.note ? `Extra instruction: ${req.note}` : '',
    `Transcript:\n${transcriptText(req.lines)}`
  ]
    .filter(Boolean)
    .join('\n')

  const r = await llmJson<{ items?: Array<Partial<CreatorItem>> }>({
    provider: req.provider,
    model: req.model,
    system,
    parts: [{ text: user }],
    schema: req.provider === 'gemini' ? ITEMS_SCHEMA : undefined,
    temperature: 0.4
  })
  const items = (r.items ?? [])
    .map((it) => ({
      title: String(it.title ?? '').trim(),
      description: String(it.description ?? '').trim(),
      hashtags: cleanTags(it.hashtags),
      hook: String(it.hook ?? '').trim(),
      keep: cleanKeep(it.keep, req.durationSec, sec * 1.15)
    }))
    .filter((it) => it.keep.length)
    .slice(0, count)
  if (!items.length) throw new Error('The AI did not return any usable clips. Try again, or pick another model in Settings.')
  return { items }
}

/** Title / description / hashtags for a full episode (or any exported video). */
export async function writeMeta(req: {
  provider: Provider
  model: string
  lines: CreatorLine[]
  metaLang: string
  series?: string
  episode?: string
}): Promise<UploadMeta> {
  const system = ['You write upload text for drama videos on YouTube / Facebook / TikTok.', metaRules(req.metaLang), 'Return JSON: { "title", "description", "hashtags" }.'].join('\n')
  // a summary needs the story, not every line: cap the transcript size
  const lines = req.lines.length > 400 ? req.lines.filter((_, i) => i % Math.ceil(req.lines.length / 400) === 0) : req.lines
  const user = [req.series ? `Series: ${req.series}${req.episode ? `, episode ${req.episode}` : ''}` : '', `Transcript:\n${transcriptText(lines) || '(no transcript)'}`]
    .filter(Boolean)
    .join('\n')
  const r = await llmJson<Partial<UploadMeta>>({
    provider: req.provider,
    model: req.model,
    system,
    parts: [{ text: user }],
    schema: req.provider === 'gemini' ? META_SCHEMA : undefined,
    temperature: 0.5
  })
  return { title: String(r.title ?? '').trim(), description: String(r.description ?? '').trim(), hashtags: cleanTags(r.hashtags) }
}

/** The .txt saved next to a video: ready to paste into an upload form. */
export function metaText(m: UploadMeta, part?: { index: number; count: number }): string {
  const title = part ? `${m.title} (${part.index}/${part.count})` : m.title
  return [title, '', m.description, '', m.hashtags.join(' ')].join('\r\n').trim() + '\r\n'
}

/** "AI Video from prompt": turn a short idea (any language, e.g. Khmer) into one detailed English video prompt. */
export async function videoPrompt(req: { provider: Provider; model: string; idea: string; seconds: number; aspect: string }): Promise<{ prompt: string }> {
  const { llmText } = await import('../lib/llm')
  const out = await llmText({
    provider: req.provider,
    model: req.model,
    system: [
      'You write prompts for an AI text-to-video model (Google Gemini Omni) that works best in English.',
      `Rewrite the user's idea (any language) as ONE detailed English prompt for a ${req.seconds}-second ${req.aspect} video with sound.`,
      'Describe: subject and characters (appearance, clothing), the action in order, setting and time of day, camera (shot size, movement), lighting, mood/style, and sounds or music.',
      'Keep it to one shot or a few simple beats that fit the length. If people speak, give at most one short line of dialogue in quotes.',
      'Keep cultural details from the idea (e.g. Cambodian / Khmer places, clothes, food). No real celebrities, brands or copyrighted characters.',
      'Reply with ONLY the prompt, no title, no quotes around it.'
    ].join('\n'),
    parts: [{ text: req.idea }],
    temperature: 0.6
  })
  return { prompt: out.trim().replace(/^["“]+|["”]+$/g, '') }
}

export interface ThumbPlan {
  /** short punchy title for the picture, in the target language */
  title: string
  /** source seconds of the most visual, emotional moments (faces!) */
  moments: number[]
  /** English description of the picture for the image model */
  scene: string
}

/** AI Thumbnail: the title and the moments to build the picture from. Times are SOURCE seconds. */
export async function thumbPlan(req: {
  provider: Provider
  model: string
  lines: CreatorLine[]
  durationSec: number
  metaLang: string
  series?: string
  episode?: string
  note?: string
}): Promise<ThumbPlan> {
  const spread = [0.2, 0.4, 0.6, 0.8].map((f) => r2(f * req.durationSec))
  if (!req.lines.length) return { title: req.series ?? '', moments: spread, scene: '' }
  const lines = req.lines.length > 400 ? req.lines.filter((_, i) => i % Math.ceil(req.lines.length / 400) === 0) : req.lines
  const system = [
    'You design click-worthy YouTube / TikTok thumbnails for drama videos, working from a timestamped transcript.',
    `"title": the text printed big on the thumbnail, in ${langName(req.metaLang)}: 2–6 words, a strong emotional hook or question, no hashtags, no emojis, no episode number. Do not spoil the ending.`,
    '"moments": 4 source times (seconds, inside a line\'s start–end) where the picture is most dramatic and shows faces with strong emotion (confrontation, shock, tears, a kiss, a fight). Spread them over the video. Best first.',
    '"scene": ONE English sentence describing the ideal thumbnail picture (who, what emotion, what action, setting), for an image AI. No names of real people.',
    'Return JSON: { "title", "moments": [numbers], "scene" }.'
  ].join('\n')
  const user = [
    req.series ? `Series: ${req.series}${req.episode ? `, episode ${req.episode}` : ''}` : '',
    `Video duration: ${r2(req.durationSec)} s.`,
    req.note ? `Extra instruction: ${req.note}` : '',
    `Transcript:\n${transcriptText(lines)}`
  ]
    .filter(Boolean)
    .join('\n')
  const r = await llmJson<Partial<{ title: string; moments: unknown[]; scene: string }>>({
    provider: req.provider,
    model: req.model,
    system,
    parts: [{ text: user }],
    schema:
      req.provider === 'gemini'
        ? { type: 'OBJECT', properties: { title: { type: 'STRING' }, moments: { type: 'ARRAY', items: { type: 'NUMBER' } }, scene: { type: 'STRING' } }, required: ['title', 'moments', 'scene'] }
        : undefined,
    temperature: 0.6
  })
  const moments = (Array.isArray(r.moments) ? r.moments : [])
    .map(Number)
    .filter((t) => Number.isFinite(t) && t >= 0 && t <= req.durationSec)
    .slice(0, 6)
  return { title: String(r.title ?? '').trim(), moments: moments.length ? moments : spread, scene: String(r.scene ?? '').trim() }
}
