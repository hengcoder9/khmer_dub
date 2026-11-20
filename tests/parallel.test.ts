import { describe, expect, it } from 'vitest'
import { llmParallelism, mapLimit } from '../shared/parallel'

describe('mapLimit', () => {
  it('keeps order and never exceeds the limit', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (ms, i) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, ms * 3))
      running--
      return i * 10
    })
    expect(out).toEqual([0, 10, 20, 30, 40])
    expect(peak).toBe(2)
  })

  it('throws the first error and stops starting new work', async () => {
    const started: number[] = []
    await expect(
      mapLimit([1, 2, 3, 4, 5], 1, async (x) => {
        started.push(x)
        if (x === 2) throw new Error('boom')
        return x
      })
    ).rejects.toThrow('boom')
    expect(started).toEqual([1, 2])
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([])
  })
})

describe('llmParallelism', () => {
  it('scales with keys within 2..8', () => {
    expect(llmParallelism(0)).toBe(2)
    expect(llmParallelism(1)).toBe(3)
    expect(llmParallelism(2)).toBe(6)
    expect(llmParallelism(10)).toBe(8)
  })
})
