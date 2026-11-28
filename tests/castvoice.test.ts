import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { keyPool } from '../backend/lib/keys'

// stand-in for Gemini: records what it was sent, answers clip 1 = girl, clip 2 = old man (clip 3 unsure)
const sent: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> = []
vi.mock('../backend/lib/llm', () => ({
  llmJson: vi.fn(async (o: { parts: never[] }) => {
    sent.push(o as never)
    return [
      { clip: 1, gender: 'female', age: 'child', confidence: 0.9 },
      { clip: 2, gender: 'male', age: 'senior', confidence: 0.8 },
      { clip: 3, gender: 'male', age: 'teen', confidence: 0.2 }
    ]
  })
}))

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

describe('who is speaking (with a stand-in AI)', () => {
  it('cuts one audio sample per actor, sends them together, applies sure answers, pitch for unsure ones', async () => {
    const { detectCastVoices } = await import('../backend/pipeline/castvoice')
    const dir = mkdtempSync(join(tmpdir(), 'kd-castv-'))
    const vid = join(dir, 'v.mp4')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:size=160x90:rate=10', '-f', 'lavfi', '-i', 'sine=f=300:sample_rate=22050', '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', vid])
    keyPool.set([{ id: 'k', provider: 'gemini', key: 'test' }])
    try {
      const r = await detectCastVoices(
        {
          videoPath: vid, epDir: dir, durationSec: 30, geminiModel: 'm',
          actors: [
            { id: 'A1', gender: 'unknown', ranges: [{ start: 1, end: 4 }, { start: 10, end: 12 }] },
            { id: 'A2', gender: 'male', ranges: [{ start: 5, end: 9 }] },
            { id: 'A3', gender: 'female', f0: 290, ranges: [{ start: 14, end: 18 }] }
          ]
        },
        ctx
      )
      expect(r.actors).toEqual([
        { id: 'A1', gender: 'female', age: 'child', by: 'ai' },
        { id: 'A2', gender: 'male', age: 'senior', by: 'ai' },
        { id: 'A3', gender: 'female', age: 'child', by: 'pitch' } // AI unsure → pitch 290 Hz = child
      ])
      // one request with three real audio samples
      expect(sent).toHaveLength(1)
      const audio = sent[0].parts.filter((p) => p.inlineData)
      expect(audio).toHaveLength(3)
      expect(audio.every((p) => p.inlineData!.mimeType === 'audio/mp3' && p.inlineData!.data.length > 1000)).toBe(true)
    } finally {
      keyPool.set([])
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
