import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exportEpisode, type ExportPayload } from '../backend/pipeline/export'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { DEFAULT_CAPTIONS } from '../shared/captions'

const mockCtx = {
  id: 'test',
  signal: new AbortController().signal,
  progress: () => {},
  log: () => {},
  throwIfCanceled: () => {}
}

describe('exportEpisode', () => {
  it('exports with re-encode (burn: true)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-exp-'))
    const epDir = join(dir, 'ep1')
    const outDir = join(dir, 'out')
    const vid = join(dir, 'source.mp4')
    const aud = join(dir, 'mix.wav')

    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100', '-t', '1', '-c:v', 'libx264', '-c:a', 'aac', vid])
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=44100', '-t', '1', aud])

    const payload: ExportPayload = {
      videoPath: vid,
      epDir,
      durationSec: 1,
      width: 320,
      height: 240,
      mixPath: aud,
      outDir,
      baseName: 'test_export_burn',
      cues: [{ start: 0, end: 0.8, text: 'Hello' }],
      captions: DEFAULT_CAPTIONS,
      captionLang: 'en',
      burn: true,
      outputs: { mp4: true, srt: true, vtt: true, ass: true },
      encoder: 'cpu'
    }

    try {
      const res = await exportEpisode(payload, mockCtx)
      expect(res.files.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)

  it('exports without re-encode (burn: false, edit: undefined, mixPath: undefined)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-exp-'))
    const epDir = join(dir, 'ep1')
    const outDir = join(dir, 'out')
    const vid = join(dir, 'source.mp4')

    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100', '-t', '1', '-c:v', 'libx264', '-c:a', 'aac', vid])

    const payload: ExportPayload = {
      videoPath: vid,
      epDir,
      durationSec: 1,
      width: 320,
      height: 240,
      mixPath: undefined,
      outDir,
      baseName: 'test_export_copy',
      cues: [],
      captions: DEFAULT_CAPTIONS,
      captionLang: 'en',
      burn: false,
      outputs: { mp4: true, srt: true, vtt: false, ass: false },
      encoder: 'cpu'
    }

    try {
      const res = await exportEpisode(payload, mockCtx)
      expect(res.files.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)

  it('exports when source video has NO audio stream and mixPath is undefined (burn: false)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-exp-'))
    const epDir = join(dir, 'ep1')
    const outDir = join(dir, 'out')
    const vid = join(dir, 'no_audio.mp4')

    // video ONLY, no audio!
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-t', '1', '-c:v', 'libx264', vid])

    const payload: ExportPayload = {
      videoPath: vid,
      epDir,
      durationSec: 1,
      width: 320,
      height: 240,
      mixPath: undefined,
      outDir,
      baseName: 'test_export_noaudio',
      cues: [],
      captions: DEFAULT_CAPTIONS,
      captionLang: 'en',
      burn: false,
      outputs: { mp4: true, srt: true, vtt: false, ass: false },
      encoder: 'cpu'
    }

    try {
      const res = await exportEpisode(payload, mockCtx)
      expect(res.files.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)

  it('exports when source video has NO audio stream and mixPath is undefined (burn: true)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-exp-'))
    const epDir = join(dir, 'ep1')
    const outDir = join(dir, 'out')
    const vid = join(dir, 'no_audio.mp4')

    // video ONLY, no audio!
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-t', '1', '-c:v', 'libx264', vid])

    const payload: ExportPayload = {
      videoPath: vid,
      epDir,
      durationSec: 1,
      width: 320,
      height: 240,
      mixPath: undefined,
      outDir,
      baseName: 'test_export_noaudio_burn',
      cues: [{ start: 0, end: 0.8, text: 'Hello' }],
      captions: DEFAULT_CAPTIONS,
      captionLang: 'en',
      burn: true,
      outputs: { mp4: true, srt: true, vtt: false, ass: false },
      encoder: 'cpu'
    }

    try {
      const res = await exportEpisode(payload, mockCtx)
      expect(res.files.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
})
