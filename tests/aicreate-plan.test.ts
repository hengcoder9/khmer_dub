import { describe, expect, it, vi } from 'vitest'

const llmJson = vi.fn()
vi.mock('../backend/lib/llm', () => ({ llmJson: (o: unknown) => llmJson(o) }))

const { planCreate, writeMeta } = await import('../backend/pipeline/aicreate')

const lines = Array.from({ length: 40 }, (_, i) => ({ start: i * 10, end: i * 10 + 8, text: `line ${i}` }))
const base = { provider: 'gemini' as const, model: 'm', durationSec: 400, lines, metaLang: 'km', series: 'Show', episode: 'E01' }

describe('planCreate (AI reply faked)', () => {
  it('returns at most `count` shorts, capped to the length, with clean tags', async () => {
    llmJson.mockResolvedValueOnce({
      items: [
        { title: ' A ', description: 'd', hashtags: ['drama', '#drama'], hook: 'Wow', keep: [{ start: 10, end: 100 }] },
        { title: 'B', keep: [{ start: 200, end: 230 }] },
        { title: 'C', keep: [{ start: 300, end: 330 }] },
        { title: 'empty', keep: [] }
      ]
    })
    const r = await planCreate({ ...base, mode: 'shorts', count: 2, seconds: 30 })
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toMatchObject({ title: 'A', hashtags: ['#drama'], hook: 'Wow', keep: [{ start: 10, end: 44.5 }] }) // 30 s × 1.15
    const prompt = llmJson.mock.calls[0][0]
    expect(prompt.system).toMatch(/Make 2 separate vertical SHORTS/)
    expect(prompt.system).toMatch(/Khmer/) // upload text in the dub language
    expect(prompt.parts[0].text).toMatch(/Series: Show, episode E01/)
  })
  it('trailer / recap ask for one video', async () => {
    llmJson.mockResolvedValueOnce({ items: [{ title: 'T', keep: [{ start: 0, end: 20 }, { start: 50, end: 70 }] }] })
    const r = await planCreate({ ...base, mode: 'trailer', seconds: 60 })
    expect(r.items).toHaveLength(1)
    expect(llmJson.mock.calls.at(-1)[0].system).toMatch(/TRAILER/)
  })
  it('explains missing lines and empty replies', async () => {
    await expect(planCreate({ ...base, lines: [], mode: 'recap', seconds: 90 })).rejects.toThrow(/no lines yet/)
    llmJson.mockResolvedValueOnce({ items: [{ title: 'x', keep: [] }] })
    await expect(planCreate({ ...base, mode: 'shorts', count: 3, seconds: 30 })).rejects.toThrow(/did not return any usable clips/)
  })
  it('writeMeta cleans the reply', async () => {
    llmJson.mockResolvedValueOnce({ title: ' T ', description: 'D', hashtags: ['a b', '#c'] })
    expect(await writeMeta(base)).toEqual({ title: 'T', description: 'D', hashtags: ['#ab', '#c'] })
  })
})
