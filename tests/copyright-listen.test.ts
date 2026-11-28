import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { keyPool } from '../backend/lib/keys'

const sent: Array<{ parts: Array<{ text?: string; inlineData?: { data: string } }> }> = []
vi.mock('../backend/lib/llm', () => ({
  llmJson: vi.fn(async (o: never) => {
    sent.push(o)
    return { hasMusic: true, kind: 'song', songs: [{ title: 'Big Hit', artist: 'Star', confidence: 0.9 }, { title: 'Maybe', confidence: 0.3 }] }
  })
}))
const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

describe('copyright check: listening', () => {
  it('sends 4 samples of the instrumental; keeps only songs it is sure about', async () => {
    const { listenForMusic } = await import('../backend/pipeline/copyright')
    const dir = mkdtempSync(join(tmpdir(), 'kd-cr-'))
    const inst = join(dir, 'inst.wav')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=44100', '-t', '120', inst])
    keyPool.set([{ id: 'k', provider: 'gemini', key: 'x' }])
    try {
      const r = await listenForMusic({ videoPath: inst, epDir: dir, durationSec: 120, instrumental: inst, geminiModel: 'm' }, ctx)
      expect(r).toEqual({ hasMusic: true, kind: 'song', songs: [{ title: 'Big Hit', artist: 'Star' }], by: 'ai' })
      expect(sent[0].parts.filter((p) => p.inlineData)).toHaveLength(4)
      expect(sent[0].parts.some((p) => p.text?.includes('voices removed'))).toBe(true)
      // no key: the music track's loudness decides
      keyPool.set([])
      const lv = await listenForMusic({ videoPath: inst, epDir: dir, durationSec: 120, instrumental: inst, geminiModel: 'm' }, ctx)
      expect(lv).toEqual({ hasMusic: true, kind: 'unknown', songs: [], by: 'level' })
      const none = await listenForMusic({ videoPath: inst, epDir: dir, durationSec: 120, geminiModel: 'm' }, ctx)
      expect(none.by).toBe('none')
    } finally {
      keyPool.set([])
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
