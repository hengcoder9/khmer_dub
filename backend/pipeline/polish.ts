// "Polish for voice": the LLM (Claude by default) writes the spoken version of each dubbing line.

import type { JobCtx } from '../queue'
import type { Provider } from '../lib/keys'
import { llmJson } from '../lib/llm'
import { chunk } from '../../shared/translate'
import { polishSystemPrompt, polishUserPrompt, validatePolish, type PolishItem } from '../../shared/voicetext'

export interface PolishPayload {
  items: PolishItem[]
  targetLang: string
  provider: Provider
  model: string
}

export async function polish(p: PolishPayload, ctx: JobCtx): Promise<{ results: Array<{ id: string; spoken: string }>; missing: number }> {
  const system = polishSystemPrompt(p.targetLang)
  const batches = chunk(p.items, 40)
  const results: Array<{ id: string; spoken: string }> = []
  for (const [i, batch] of batches.entries()) {
    ctx.throwIfCanceled()
    ctx.progress((i / batches.length) * 100, `Polishing lines ${i * 40 + 1}–${i * 40 + batch.length} of ${p.items.length}`)
    const raw = await llmJson<unknown>({ provider: p.provider, model: p.model, system, parts: [{ text: polishUserPrompt(batch) }], temperature: 0.2, signal: ctx.signal })
    results.push(...validatePolish(batch, raw))
  }
  ctx.progress(100, `Polished ${results.length} lines`)
  return { results, missing: p.items.length - results.length }
}
