// Regression: a dub mix shorter than the video must not shorten the exported video or shift subtitles.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exportEpisode, type ExportPayload } from '../backend/pipeline/export'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { probeMedia } from '../backend/lib/ffmpeg'
import { DEFAULT_CAPTIONS } from '../shared/captions'

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'kd-len-'))
  const vid = join(dir, 'source.mp4')
  const mix = join(dir, 'mix.wav')
  // 6 s video, but only a 2 s dub mix
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100', '-t', '6', '-c:v', 'libx264', '-c:a', 'aac', vid])
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=44100', '-t', '2', mix])
  const payload: ExportPayload = {
    videoPath: vid, epDir: join(dir, 'ep'), durationSec: 6, width: 320, height: 240, mixPath: mix, outDir: join(dir, 'out'),
    baseName: 'len', cues: [{ start: 4.2, end: 5.5, text: 'late line' }], captions: DEFAULT_CAPTIONS, captionLang: 'en',
    burn: false, outputs: { mp4: true, srt: true, vtt: false, ass: false }, encoder: 'cpu'
  }
  return { dir, payload }
}

const dur = async (f: string) => {
  const m = await probeMedia(f)
  return { format: m.durationSec, hasAudio: !!m.audio }
}

describe('export length with a short dub mix', () => {
  it('copy-mux keeps the full video length', async () => {
    const { dir, payload } = await setup()
    try {
      const r = await exportEpisode(payload, ctx)
      const d = await dur(r.files[0])
      expect(d.format).toBeGreaterThan(5.8)
      expect(d.format).toBeLessThan(6.3)
      expect(readFileSync(join(dir, 'out', 'len.srt'), 'utf8')).toContain('00:00:04,200 --> 00:00:05,500')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('edited export: clips past the end of the mix keep their length and the SRT follows the edit', async () => {
    const { dir, payload } = await setup()
    try {
      // keep 0–1 s and 4–6 s → 3 s output; the line at 4.2 s moves to 1.2 s
      const r = await exportEpisode(
        { ...payload, edit: { clips: [{ start: 0, end: 1 }, { start: 4, end: 6 }], aspect: 'source', fitMode: 'crop', fadeIn: 0, fadeOut: 0 } },
        ctx
      )
      const d = await dur(r.files[0])
      expect(d.hasAudio).toBe(true)
      expect(d.format).toBeGreaterThan(2.8)
      expect(d.format).toBeLessThan(3.3)
      expect(readFileSync(join(dir, 'out', 'len.srt'), 'utf8')).toContain('00:00:01,200 --> 00:00:02,500')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
