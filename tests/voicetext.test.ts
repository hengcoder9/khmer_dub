import { describe, expect, it, vi } from 'vitest'
import { needsPolish, polishSystemPrompt, polishUserPrompt, spokenText, validatePolish } from '../shared/voicetext'
import { systemPrompt } from '../shared/translate'

const llmJson = vi.fn()
vi.mock('../backend/lib/llm', () => ({ llmJson: (o: unknown) => llmJson(o) }))
const { polish } = await import('../backend/pipeline/polish')

const ctx = { id: 't', signal: new AbortController().signal, progress: vi.fn(), log: () => {}, throwIfCanceled: () => {} }

describe('polish for voice', () => {
  it('the voice reads the spoken version only while it matches the subtitle', () => {
    expect(spokenText({ textTarget: 'ខ្ញុំមាន 25 ដុល្លារ', textSpoken: 'ខ្ញុំមានម្ភៃប្រាំដុល្លារ', spokenFor: 'ខ្ញុំមាន 25 ដុល្លារ' })).toBe('ខ្ញុំមានម្ភៃប្រាំដុល្លារ')
    // subtitle edited afterwards → back to the subtitle until polished again
    expect(spokenText({ textTarget: 'ខ្ញុំមាន 30 ដុល្លារ', textSpoken: 'ខ្ញុំមានម្ភៃប្រាំដុល្លារ', spokenFor: 'ខ្ញុំមាន 25 ដុល្លារ' })).toBe('ខ្ញុំមាន 30 ដុល្លារ')
    expect(spokenText({ textTarget: 'សួស្តី' })).toBe('សួស្តី')
    expect(needsPolish({ textTarget: 'សួស្តី' })).toBe(true)
    expect(needsPolish({ textTarget: 'សួស្តី', spokenFor: 'សួស្តី' })).toBe(false) // polished, nothing to change
    expect(needsPolish({ textTarget: '  ' })).toBe(false)
  })
  it('prompts with Khmer examples and the line timing', () => {
    expect(polishSystemPrompt('km')).toMatch(/ម្ភៃប្រាំ/)
    expect(polishSystemPrompt('km')).toMatch(/បង, អូន/)
    expect(polishSystemPrompt('th')).toMatch(/Thai/)
    expect(polishUserPrompt([{ id: 'a', text: 'OK', seconds: 1.234 }])).toContain('"seconds":1.2')
  })
  it('keeps only known ids with text', () => {
    const items = [{ id: 'a', text: 'x', seconds: 1 }, { id: 'b', text: 'y', seconds: 1 }]
    expect(validatePolish(items, [{ id: 'a', spoken: ' A ' }, { id: 'zz', spoken: 'Q' }, { id: 'b', spoken: '' }, { id: 'a', spoken: 'dup' }])).toEqual([{ id: 'a', spoken: 'A' }])
    expect(validatePolish(items, { lines: [{ id: 'b', text: 'B' }] })).toEqual([{ id: 'b', spoken: 'B' }])
    expect(validatePolish(items, 'garbage')).toEqual([])
  })
  it('the job batches 40 lines per AI call and reports missing ones', async () => {
    const items = Array.from({ length: 85 }, (_, i) => ({ id: `s${i}`, text: `line ${i}`, seconds: 2 }))
    llmJson.mockImplementation(async (o: { parts: Array<{ text: string }> }) => {
      const sent = JSON.parse(o.parts[0].text.replace(/^Lines:\n/, '')) as Array<{ id: string; text: string }>
      return sent.filter((x) => x.id !== 's3').map((x) => ({ id: x.id, spoken: x.text.toUpperCase() }))
    })
    const r = await polish({ items, targetLang: 'km', provider: 'claude', model: 'claude-opus-5-5' }, ctx)
    expect(llmJson).toHaveBeenCalledTimes(3)
    expect(llmJson.mock.calls[0][0]).toMatchObject({ provider: 'claude', model: 'claude-opus-5-5' })
    expect(r.results).toHaveLength(84)
    expect(r.missing).toBe(1)
    expect(r.results[0]).toEqual({ id: 's0', spoken: 'LINE 0' })
  })
})

describe('Khmer translation prompt', () => {
  it('adds Khmer-only rules', () => {
    expect(systemPrompt('km', [])).toMatch(/spoken Khmer/)
    expect(systemPrompt('km', [])).toMatch(/no Latin letters/)
    expect(systemPrompt('th', [])).not.toMatch(/Khmer script/)
  })
})
