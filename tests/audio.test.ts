import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mixDub, readWavInfo, SR, wavHeader } from '../backend/lib/audio'

function writeTone(path: string, seconds: number, value: number) {
  const n = Math.round(seconds * SR)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) data.writeInt16LE(value, i * 2)
  writeFileSync(path, Buffer.concat([wavHeader(n), data]))
}

describe('mixDub', () => {
  it('places clips at their start times, applies gain and clamps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-mix-'))
    const a = join(dir, 'a.wav')
    const b = join(dir, 'b.wav')
    writeTone(a, 1, 1000)
    writeTone(b, 1, 30000)
    const out = join(dir, 'out.wav')
    await mixDub(
      [
        { path: b, start: 5.5, gain: 2 }, // clamps to 32767
        { path: a, start: 1, gain: 0.5 },
        { path: a, start: 5, gain: 1 } // overlaps b
      ],
      10,
      out
    )
    const info = await readWavInfo(out)
    expect(info.duration).toBeCloseTo(10, 3)
    const buf = readFileSync(out)
    const at = (t: number) => buf.readInt16LE(info.dataOffset + Math.round(t * SR) * 2)
    expect(at(0.5)).toBe(0)
    expect(at(1.5)).toBe(500)
    expect(at(2.5)).toBe(0)
    expect(at(5.2)).toBe(1000)
    expect(at(5.7)).toBe(32767)
    expect(at(6.3)).toBe(32767)
    expect(at(6.6)).toBe(0)
  })
})
