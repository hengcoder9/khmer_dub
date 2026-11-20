// Bounded-parallel map (pure, unit tested). Results keep input order; the first error stops new work and is thrown.

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  let failed: unknown = null
  const worker = async () => {
    while (failed === null && next < items.length) {
      const i = next++
      try {
        out[i] = await fn(items[i], i)
      } catch (e) {
        if (failed === null) failed = e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  if (failed !== null) throw failed
  return out
}

/** Parallel LLM requests to allow: 3 per key, between 2 and 8 (429s are handled by key cooldown + retry). */
export function llmParallelism(keyCount: number): number {
  return Math.max(2, Math.min(8, keyCount * 3))
}
