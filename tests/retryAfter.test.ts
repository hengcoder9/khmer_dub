import { describe, expect, it } from 'vitest'
import { retryAfterMs } from '../backend/lib/llm'

describe('retryAfterMs', () => {
  it('reads Gemini daily-quota waits', () => {
    expect(retryAfterMs('Gemini 429: You exceeded your current quota.\nPlease retry in 21h44m31.786427384s.')).toBe(78271786)
    expect(retryAfterMs('Please retry in 37.5s.')).toBe(37500)
    expect(retryAfterMs('Please retry in 2m5s')).toBe(125000)
    expect(retryAfterMs('{"retryDelay": "60s"}')).toBe(60000)
    expect(retryAfterMs('rate limited')).toBeNull()
  })
})
