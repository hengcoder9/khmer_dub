/**
 * Minimal EMV / KHQR reader: top-level tag-length-value fields of a KHQR string.
 * 59 = merchant name, 60 = city, 54 = amount, 53 = currency (840 USD, 116 KHR).
 */
export function parseEmv(qr: string): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i + 4 <= qr.length) {
    const tag = qr.slice(i, i + 2)
    const len = Number(qr.slice(i + 2, i + 4))
    if (!/^\d{2}$/.test(tag) || !Number.isFinite(len)) break
    out[tag] = qr.slice(i + 4, i + 4 + len)
    i += 4 + len
  }
  return out
}

export function khqrInfo(qr: string | null | undefined): { merchant?: string; city?: string; amount?: string; currency?: 'USD' | 'KHR' } {
  if (!qr) return {}
  const f = parseEmv(qr)
  return {
    merchant: f['59'] || undefined,
    city: f['60'] || undefined,
    amount: f['54'] || undefined,
    currency: f['53'] === '116' ? 'KHR' : f['53'] === '840' ? 'USD' : undefined
  }
}
