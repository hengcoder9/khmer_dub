// "Polish for voice": a spoken version of each dubbing line, separate from the subtitle (pure, unit tested).
import type { Segment } from './types'
import { langName } from './translate'

/** The text the voice reads: the polished spoken line while it still belongs to the current subtitle, else the subtitle. */
export function spokenText(s: Pick<Segment, 'textTarget' | 'textSpoken' | 'spokenFor'>): string {
  return s.textSpoken && s.spokenFor === s.textTarget ? s.textSpoken : s.textTarget
}

/** Lines that have a subtitle but no up-to-date spoken version yet. */
export const needsPolish = (s: Pick<Segment, 'textTarget' | 'textSpoken' | 'spokenFor'>) => !!s.textTarget.trim() && s.spokenFor !== s.textTarget

export interface PolishItem {
  id: string
  text: string
  original?: string
  /** time the line has on screen */
  seconds: number
}

export function polishSystemPrompt(targetLang: string): string {
  const lang = langName(targetLang)
  const km = targetLang === 'km'
  return [
    `You prepare ${lang} dubbing lines for a text-to-speech voice. The subtitle stays as it is; you write what the voice should SAY.`,
    'For each line:',
    `- Write numbers, dates, times, money, percentages and units as ${lang} words (${km ? 'e.g. 25 → ម្ភៃប្រាំ, 3:30 → បីម៉ោងកន្លះ, $10 → ដប់ដុល្លារ, ៥ → ប្រាំ' : 'as a native speaker reads them'}).`,
    `- Write English / Latin-script words and abbreviations the way a ${lang} speaker says them, in ${lang} script${km ? ' (e.g. OK → អូខេ, CEO → ស៊ីអ៊ីអូ, Facebook → ហ្វេសប៊ុក)' : ''}.`,
    '- Remove symbols the voice should not read: emojis, brackets, quotes, "…", "~", "*", hashtags, and speaker labels.',
    km ? '- Keep natural spoken Khmer with the same pronouns and kinship words (បង, អូន, លោក, អ្នក…). Do not make it formal or written-style.' : '- Keep it natural and spoken, with the same tone.',
    '- Keep the meaning, names and tone. Do not translate again, explain, or add words.',
    '- "seconds" is the time the line has on screen. If the line is clearly too long to say in that time, shorten it a little without losing the meaning.',
    '- If a line is already fine to speak, return it unchanged.',
    'Return ONLY JSON: [{"id":"...","spoken":"..."}] with exactly the same ids.'
  ].join('\n')
}

export const polishUserPrompt = (items: PolishItem[]) =>
  `Lines:\n${JSON.stringify(items.map((i) => ({ id: i.id, text: i.text, ...(i.original ? { original: i.original } : {}), seconds: Math.round(i.seconds * 10) / 10 })))}`

/** Accepts [{id, spoken}] (or {id, text}); keeps only known ids with non-empty text. */
export function validatePolish(items: PolishItem[], raw: unknown): Array<{ id: string; spoken: string }> {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { lines?: unknown })?.lines) ? (raw as { lines: unknown[] }).lines : []
  const ids = new Set(items.map((i) => i.id))
  const out: Array<{ id: string; spoken: string }> = []
  for (const r of list as Array<Record<string, unknown>>) {
    const id = String(r?.id ?? '')
    const spoken = String(r?.spoken ?? r?.text ?? '').trim()
    if (ids.has(id) && spoken && !out.some((o) => o.id === id)) out.push({ id, spoken })
  }
  return out
}
