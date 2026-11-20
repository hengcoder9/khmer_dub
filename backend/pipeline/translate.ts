import type { Translator } from '../../shared/types'
import {
  chunk,
  langName,
  properNounCandidates,
  systemPrompt,
  userPrompt,
  validateTranslation,
  type Glossary,
  type TItem,
  type TResult
} from '../../shared/translate'
import { llmJson, llmText } from '../lib/llm'
import { aiWorker } from '../lib/python'
import type { JobCtx } from '../queue'
import { keyPool, type Provider } from '../lib/keys'
import { DEFAULT_CLAUDE_MODEL } from '../../shared/types'
import { llmParallelism, mapLimit } from '../../shared/parallel'

export interface TranslatePayload {
  items: TItem[]
  provider: Translator
  targetLang: string
  sourceLang: string
  glossary: Glossary[]
  /** lines already translated before these items, for context */
  context?: TResult[]
  geminiModel: string
  openrouterModel: string
  claudeModel?: string
}

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { id: { type: 'STRING' }, khmer: { type: 'STRING' } },
    required: ['id', 'khmer'],
    propertyOrdering: ['id', 'khmer']
  }
}

export async function translate(p: TranslatePayload, ctx: JobCtx): Promise<{ results: TResult[]; suggestions: string[] }> {
  const items = p.items.filter((i) => i.text.trim())
  const suggestions = properNounCandidates(items.map((i) => i.text), p.glossary)
  if (!items.length) return { results: [], suggestions }

  if (p.provider === 'offline') {
    const r = await aiWorker.job<{ results: TResult[] }>('mt', { items, src: p.sourceLang, tgt: p.targetLang }, ctx)
    return { results: r.results, suggestions }
  }

  const sys = systemPrompt(p.targetLang, p.glossary)
  const provider = p.provider as Provider
  const model = provider === 'gemini' ? p.geminiModel : provider === 'claude' ? p.claudeModel || DEFAULT_CLAUDE_MODEL : p.openrouterModel
  const context = [...(p.context ?? [])].slice(-10)
  const chunks = chunk(items, 60)

  const run = async (part: TItem[], depth: number, ctxLines: TResult[], before: TItem[]): Promise<TResult[]> => {
    let lastErr: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      ctx.throwIfCanceled()
      try {
        const raw = await llmJson({
          provider,
          model,
          system: sys,
          parts: [{ text: userPrompt(part, ctxLines, before) }],
          schema: p.provider === 'gemini' ? SCHEMA : undefined,
          temperature: 0.3,
          signal: ctx.signal
        })
        return validateTranslation(part, raw)
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        lastErr = e as Error
        ctx.log(`translate retry ${attempt + 1}: ${lastErr.message}`)
      }
    }
    if (part.length > 1 && depth < 6) {
      const mid = Math.ceil(part.length / 2)
      return [
        ...(await run(part.slice(0, mid), depth + 1, ctxLines, before)),
        ...(await run(part.slice(mid), depth + 1, ctxLines, before))
      ]
    }
    throw lastErr ?? new Error('Translation failed')
  }

  // batches run in parallel; each sees the source lines just before it instead of waiting for earlier translations
  let done = 0
  ctx.progress(0, `Translating ${items.length} lines`)
  const lanes = llmParallelism(keyPool.all(provider).length)
  const parts = await mapLimit(chunks, lanes, async (part, i) => {
    const r = await run(part, 0, i === 0 ? context : [], i === 0 ? [] : chunks[i - 1].slice(-8))
    done += part.length
    ctx.progress((done / items.length) * 100, `Translated ${done} of ${items.length}`)
    return r
  })
  return { results: parts.flat(), suggestions }
}

/** Ask the LLM for a shorter line that fits the time slot. */
export async function shortenLine(p: {
  text: string
  original: string
  targetLang: string
  ratio: number
  provider: Provider
  model: string
}): Promise<string> {
  const pct = Math.max(30, Math.min(90, Math.round(100 / Math.max(1.05, p.ratio))))
  const out = await llmText({
    provider: p.provider,
    model: p.model,
    system: `You shorten ${langName(p.targetLang)} dubbing lines. Keep the meaning, tone and names. Reply with ONLY the new line, no quotes.`,
    parts: [
      {
        text: `Original line: ${p.original}\nCurrent ${langName(p.targetLang)} line: ${p.text}\nRewrite it so it is about ${pct}% of the current spoken length.`
      }
    ],
    temperature: 0.4
  })
  return out.trim().replace(/^["“'«]+|["”'»]+$/g, '')
}
