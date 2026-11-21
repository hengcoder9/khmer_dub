// "Claude Video": Claude writes the scenes, KhmerDub renders them (pure parts, unit tested).
import { langName } from './translate'
import { tokenize } from './captions'

export type StoryStyle = 'story' | 'explainer' | 'motivation' | 'news' | 'ad'
export type StoryBackground = 'colors' | 'media' | 'omni'

export interface StoryScene {
  /** what the narrator says (target language, spoken form) */
  narration: string
  /** big on-screen title for the scene (2–6 words) */
  title: string
  /** two background colours (#RRGGBB) matching the mood */
  colors: [string, string]
  /** English camera prompt for a text-to-video model (used when Omni films the shots) */
  shot: string
}

export interface StoryPlan {
  title: string
  description: string
  hashtags: string[]
  scenes: StoryScene[]
}

export const STYLE_TEXT: Record<StoryStyle, string> = {
  story: 'a short dramatic story with a beginning, a twist and an ending',
  explainer: 'a clear explainer that teaches one thing step by step',
  motivation: 'an inspiring motivational piece with memorable quotes',
  news: 'a short news-style report with the key facts',
  ad: 'a short product / business advertisement with a call to action at the end'
}

/** Khmer is read at about 15 characters per second (measured from Edge's Khmer voices). */
export const KHMER_CPS = 15

export function sceneCount(seconds: number): number {
  return Math.max(3, Math.min(12, Math.round(seconds / 7)))
}

export function storySystemPrompt(lang: string, style: StoryStyle, seconds: number): string {
  const n = sceneCount(seconds)
  const per = Math.round(seconds / n)
  const L = langName(lang)
  return [
    `You write short vertical videos for social media. Write ${STYLE_TEXT[style]}, about ${seconds} seconds long, in ${L}.`,
    `Split it into exactly ${n} scenes of about ${per} seconds each.`,
    `For each scene return:`,
    `- "narration": what the narrator SAYS, natural spoken ${L}${lang === 'km' ? ` (about ${per * KHMER_CPS} Khmer characters, numbers written as Khmer words, Khmer script only)` : ''}. The first scene must hook the viewer in its first sentence.`,
    `- "title": 2–6 punchy words shown big on screen, in ${L}.`,
    '- "colors": two background colours as "#RRGGBB" that fit the mood of the scene.',
    '- "shot": an English prompt for an AI video model describing what we SEE in this scene (subject, action, setting, camera, light); no text, logos, real celebrities or brands.',
    `Also return "title" (video title, ${L}, under 70 characters), "description" (1–2 sentences, ${L}) and "hashtags" (5–10, starting with "#").`,
    'Return ONLY JSON: {"title","description","hashtags":[],"scenes":[{"narration","title","colors":["#...","#..."],"shot"}]}.'
  ].join('\n')
}

const HEX = /^#[0-9a-f]{6}$/i

/** Clean the model's JSON into a usable plan (or throw a clear error). */
export function validateStory(raw: unknown): StoryPlan {
  const r = (raw ?? {}) as Record<string, unknown>
  const scenes = (Array.isArray(r.scenes) ? r.scenes : [])
    .map((s: any) => {
      const colors = (Array.isArray(s?.colors) ? s.colors : []).map(String).filter((c: string) => HEX.test(c))
      return {
        narration: String(s?.narration ?? '').trim(),
        title: String(s?.title ?? '').trim(),
        colors: [colors[0] ?? '#1E3A8A', colors[1] ?? colors[0] ?? '#7C3AED'] as [string, string],
        shot: String(s?.shot ?? '').trim()
      }
    })
    .filter((s) => s.narration)
    .slice(0, 12)
  if (!scenes.length) throw new Error('The AI did not write any scenes. Try again, or change the topic.')
  const tags: string[] = []
  for (const t of Array.isArray(r.hashtags) ? r.hashtags : []) {
    const s = String(t).trim().replace(/^#+/, '').replace(/\s+/g, '')
    if (s && !tags.includes(`#${s}`)) tags.push(`#${s}`)
  }
  return { title: String(r.title ?? '').trim() || scenes[0].title, description: String(r.description ?? '').trim(), hashtags: tags.slice(0, 12), scenes }
}

/** Scene length from its narration audio: a short lead-in and a breath after, at least 2.5 s. */
export const sceneSeconds = (audioSec: number) => Math.max(2.5, Math.round((audioSec + 0.3 + 0.5) * 100) / 100)

/** Split a narration into caption chunks (sentence ends, then ~maxChars) with times spread over [start, end] by length. */
export function narrationCues(text: string, start: number, end: number, maxChars = 42, lang = 'km'): Array<{ start: number; end: number; text: string }> {
  const sentences = text.split(/(?<=[។៕!?.！？])\s*/).map((s) => s.trim()).filter(Boolean)
  const chunks: string[] = []
  for (const s of sentences.length ? sentences : [text]) {
    if (s.length <= maxChars) {
      chunks.push(s)
      continue
    }
    // long sentence: break between WORDS (Khmer has no spaces — use the word segmenter, never cut inside a word)
    let line = ''
    for (const word of tokenize(s, lang)) {
      if (line && (line + word).trim().length > maxChars) {
        chunks.push(line.trim())
        line = ''
      }
      line += word
    }
    if (line.trim()) chunks.push(line.trim())
  }
  const total = chunks.reduce((a, c) => a + c.length, 0) || 1
  const out: Array<{ start: number; end: number; text: string }> = []
  let t = start
  for (const c of chunks) {
    const d = ((end - start) * c.length) / total
    out.push({ start: Math.round(t * 100) / 100, end: Math.round((t + d) * 100) / 100, text: c })
    t += d
  }
  return out
}
