// Translation chunking, prompting and validation (pure, unit tested).

export interface TItem {
  id: string
  text: string
}

export interface TResult {
  id: string
  khmer: string
}

export interface Glossary {
  source: string
  target: string
}

export const LANG_NAMES: Record<string, string> = {
  km: 'Khmer',
  en: 'English',
  th: 'Thai',
  vi: 'Vietnamese',
  zh: 'Chinese',
  ko: 'Korean',
  ja: 'Japanese',
  id: 'Indonesian',
  lo: 'Lao',
  fr: 'French',
  es: 'Spanish'
}

export const langName = (code: string) => LANG_NAMES[code] ?? code

export function chunk<T>(items: T[], size = 60): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function systemPrompt(targetLang: string, glossary: Glossary[]): string {
  const lang = langName(targetLang)
  const g = glossary.length ? glossary.map((x) => `${x.source} = ${x.target}`).join('\n') : '(none)'
  return [
    `You are a professional ${lang} dubbing translator for drama/film.`,
    `Translate each line into natural, spoken ${lang} that a voice actor can say aloud.`,
    'Keep it short enough to be spoken in roughly the same time as the original.',
    'Keep character names consistent with the glossary. Keep tone (angry, polite, joking).',
    ...(targetLang === 'km'
      ? [
          'Khmer: write everyday spoken Khmer, not formal or written-style Khmer.',
          'Choose pronouns and kinship terms from the relationship and tone (បង / អូន between partners and siblings, លោក / អ្នកនាង / អ្នក for strangers and superiors, ខ្ញុំ / យើង / ឯង / អញ when rude), and keep them consistent for the same pair of characters.',
          'Write everything in Khmer script: no Latin letters; say English words the way Khmer speakers do.',
          'Use natural Khmer sentence-final particles (ណា៎, ហើយ, ទេ, ចុះ) where a native speaker would.'
        ]
      : []),
    'Do not add explanations. Return ONLY JSON: [{"id":"...","khmer":"..."}] with exactly the same ids.',
    '(The "khmer" field holds the translation even when the target language is not Khmer.)',
    `Glossary:\n${g}`
  ].join('\n')
}

export function userPrompt(items: TItem[], context: TResult[], before: TItem[] = []): string {
  const ctx = context.length
    ? `Previous translated lines for context (do not return these):\n${JSON.stringify(context)}\n\n`
    : ''
  const prev = before.length
    ? `Source lines just before these, for context only (do not return these):\n${JSON.stringify(before)}\n\n`
    : ''
  return `${ctx}${prev}Lines to translate:\n${JSON.stringify(items)}`
}

/** Extract the first JSON array/object from an LLM reply (handles ```json fences and chatter). */
export function extractJson<T = unknown>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const a = cleaned.indexOf('[')
    const o = cleaned.indexOf('{')
    const start = a >= 0 && (o < 0 || a < o) ? a : o
    const end = start === a ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('No JSON found in model response')
    return JSON.parse(cleaned.slice(start, end + 1)) as T
  }
}

/** Accepts [{id, khmer}] or [{id, text|translation|target}] — returns normalized results or throws. */
export function validateTranslation(items: TItem[], raw: unknown): TResult[] {
  const arr = Array.isArray(raw) ? raw : (raw as { lines?: unknown[] })?.lines
  if (!Array.isArray(arr)) throw new Error('Response is not a JSON array')
  const results: TResult[] = arr.map((r) => {
    const o = r as Record<string, unknown>
    const t = o.khmer ?? o.translation ?? o.target ?? o.text
    return { id: String(o.id ?? ''), khmer: typeof t === 'string' ? t.trim() : '' }
  })
  if (results.length !== items.length) throw new Error(`Expected ${items.length} lines, got ${results.length}`)
  const want = new Set(items.map((i) => i.id))
  const got = new Set(results.map((r) => r.id))
  if (got.size !== want.size || [...want].some((id) => !got.has(id))) throw new Error('Returned ids do not match')
  if (results.some((r) => !r.khmer)) throw new Error('Empty translation in response')
  return results
}

/** Capitalized multi-letter words that look like names, for glossary suggestions. */
export function properNounCandidates(texts: string[], known: Glossary[]): string[] {
  const seen = new Map<string, number>()
  const knownSet = new Set(known.map((g) => g.source.toLowerCase()))
  const STOP = new Set(['I', 'The', 'A', 'An', 'And', 'But', 'What', 'Why', 'How', 'Who', 'Where', 'When', 'Yes', 'No', 'Oh', 'OK', 'Okay', 'Hey', 'Mr', 'Mrs', 'Ms', 'You', 'We', 'He', 'She', 'It', 'They', 'This', 'That', 'Is', 'Are', 'Do', 'Don', 'Let', 'If', 'So', 'My', 'Your', 'Please', 'Thank', 'Thanks', 'Sorry', 'Well', 'Come', 'Go', 'Wait', 'Look', 'Stop'])
  for (const t of texts) {
    const words = t.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}\b/g) ?? []
    for (const w of words) if (!STOP.has(w) && !knownSet.has(w.toLowerCase())) seen.set(w, (seen.get(w) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 30)
}
