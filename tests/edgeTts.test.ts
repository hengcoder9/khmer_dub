import { describe, expect, it } from 'vitest'
import { secMsGec, splitText } from '../backend/lib/edgeTts'

// reference values from Python edge-tts 7.3.1: edge_tts.drm.generate_sec_ms_gec_v2(t)
const VECTORS: Array<[number, string]> = [
  [0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
  [1700000000, '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2'],
  [1763650000.5, 'B3E914E9AA491F11-C0ABF48290F82E57E1DDE34402A198DA906794EF040A0601A9696A256D3FC387'],
  [1795000123, '6521DCC55F99AAD7-6D04852628E3DF4D0EF33213239BDC3C48750FE37FE5E4591F28C209CE0A3FA2'],
  [2000000000, '2D62557F1142BC5D-FD9C30C68FF194A5EE6B45FEFC5E2BA1D1239F88A90569AB55CFFFAA7799F40E']
]

describe('edge-tts', () => {
  it.each(VECTORS)('Sec-MS-GEC v2 token matches Python at t=%s', (t, want) => {
    expect(secMsGec(t)).toBe(want)
  })

  it('splits long text on spaces without breaking UTF-8 or entities', () => {
    const khmer = 'សួស្តី'.repeat(400) // no spaces, 3-byte chars
    const parts = splitText(khmer, 100)
    expect(parts.join('')).toBe(khmer)
    for (const p of parts) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(100)
    expect(splitText('aaaa bbbb', 6)).toEqual(['aaaa', 'bbbb'])
    expect(splitText('abc&amp;def', 6)).toEqual(['abc', '&amp;d', 'ef'])
  })
})
