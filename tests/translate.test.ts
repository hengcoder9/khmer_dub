import { describe, expect, it } from 'vitest'
import { chunk, extractJson, properNounCandidates, systemPrompt, validateTranslation } from '../shared/translate'

const items = [
  { id: 'a', text: 'Hello' },
  { id: 'b', text: 'Bye' }
]

describe('translate', () => {
  it('chunks by size', () => {
    const arr = Array.from({ length: 130 }, (_, i) => i)
    expect(chunk(arr, 60).map((c) => c.length)).toEqual([60, 60, 10])
    expect(chunk([], 60)).toEqual([])
  })

  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson('```json\n[{"id":"a"}]\n```')).toEqual([{ id: 'a' }])
    expect(extractJson('Sure! Here it is: [{"id":"a","khmer":"x"}] hope that helps')).toEqual([{ id: 'a', khmer: 'x' }])
    expect(() => extractJson('no json here')).toThrow()
  })

  it('validates ids and count', () => {
    expect(validateTranslation(items, [{ id: 'b', khmer: 'លា' }, { id: 'a', khmer: 'សួស្តី' }])).toHaveLength(2)
    expect(() => validateTranslation(items, [{ id: 'a', khmer: 'x' }])).toThrow(/Expected 2/)
    expect(() => validateTranslation(items, [{ id: 'a', khmer: 'x' }, { id: 'c', khmer: 'y' }])).toThrow(/ids/)
    expect(() => validateTranslation(items, [{ id: 'a', khmer: 'x' }, { id: 'b', khmer: '' }])).toThrow(/Empty/)
  })

  it('accepts alternative field names', () => {
    expect(validateTranslation(items, [{ id: 'a', translation: 'x' }, { id: 'b', text: 'y' }])[1].khmer).toBe('y')
  })

  it('puts glossary in system prompt', () => {
    const p = systemPrompt('km', [{ source: 'John', target: 'ចន' }])
    expect(p).toContain('Khmer dubbing translator')
    expect(p).toContain('John = ចន')
  })

  it('suggests repeated proper nouns', () => {
    const t = ['Where is Sokha now?', 'I saw Sokha and Dara.', 'Dara! Come here, Dara.', 'The car is red.']
    expect(properNounCandidates(t, [])).toEqual(expect.arrayContaining(['Sokha', 'Dara']))
    expect(properNounCandidates(t, [{ source: 'Dara', target: 'តារា' }])).not.toContain('Dara')
  })
})
