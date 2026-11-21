import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { cleanKeep, cleanTags, metaText } from '../backend/pipeline/aicreate'
import { exportEpisode } from '../backend/pipeline/export'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { DEFAULT_CAPTIONS } from '../shared/captions'

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

describe('AI Creator helpers', () => {
  it('cleans hashtags', () => {
    expect(cleanTags(['drama', '#Khmer Drama', '##love', 'DRAMA', '', 5])).toEqual(['#drama', '#KhmerDrama', '#love', '#5'])
    expect(cleanTags('nope')).toEqual([])
  })
  it('keeps clips inside the video and within the length', () => {
    expect(cleanKeep([{ start: -5, end: 10 }, { start: 20, end: 1e9 }], 100, 1000)).toEqual([{ start: 0, end: 10 }, { start: 20, end: 100 }])
    // 45 s target: the second clip is trimmed, the third dropped
    expect(cleanKeep([{ start: 0, end: 30 }, { start: 50, end: 80 }, { start: 90, end: 99 }], 100, 45)).toEqual([{ start: 0, end: 30 }, { start: 50, end: 65 }])
    expect(cleanKeep([{ start: 'x', end: 3 }, { start: 5, end: 5.2 }], 100, 60)).toEqual([])
  })
  it('writes paste-ready upload text', () => {
    const m = { title: 'រឿងស្នេហា', description: 'ពេលនាងត្រឡប់មកវិញ…', hashtags: ['#drama', '#khmer'] }
    expect(metaText(m)).toBe('រឿងស្នេហា\r\n\r\nពេលនាងត្រឡប់មកវិញ…\r\n\r\n#drama #khmer\r\n')
    expect(metaText(m, { index: 2, count: 3 }).split('\r\n')[0]).toBe('រឿងស្នេហា (2/3)')
  })
})

describe('export with AI upload text', () => {
  it('writes <video>.txt, and one per part when splitting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-meta-'))
    const vid = join(dir, 'src.mp4')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=5', '-f', 'lavfi', '-i', 'sine=sample_rate=22050', '-t', '150', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-c:a', 'aac', '-shortest', vid])
    const meta = { title: 'Episode title', description: 'Story.', hashtags: ['#a', '#b'] }
    const base = {
      videoPath: vid, epDir: join(dir, 'ep'), durationSec: 150, width: 160, height: 120, cues: [{ start: 1, end: 3, text: 'hi' }],
      captions: DEFAULT_CAPTIONS, captionLang: 'en', burn: false, outputs: { mp4: true, srt: false, vtt: false, ass: false }, encoder: 'cpu' as const, meta
    }
    try {
      const one = await exportEpisode({ ...base, outDir: join(dir, 'one'), baseName: 'Show_E01' }, ctx)
      expect(one.files.map((f) => basename(f))).toEqual(['Show_E01.mp4', 'Show_E01.txt'])
      expect(readFileSync(join(dir, 'one', 'Show_E01.txt'), 'utf8')).toContain('#a #b')

      // a short: edit clips + 9:16, like the AI Creator export
      const short = await exportEpisode(
        { ...base, outDir: join(dir, 'short'), baseName: 'Show_E01_Short01', edit: { clips: [{ id: 'c', start: 10, end: 25 }], aspect: '9:16', fitMode: 'blur', fadeIn: 0.2, fadeOut: 0.4 } },
        ctx
      )
      expect(short.files.map((f) => basename(f))).toEqual(['Show_E01_Short01.mp4', 'Show_E01_Short01.txt'])

      const parts = await exportEpisode({ ...base, outDir: join(dir, 'parts'), baseName: 'Show_E01', splitMinutes: 1 }, ctx)
      const txts = parts.files.filter((f) => f.endsWith('.txt')).map((f) => basename(f))
      // 150 s every minute → 60 + 60 + 30 (a 30 s tail is too long to merge)
      expect(txts).toEqual(['Show_E01 EP01.txt', 'Show_E01 EP02.txt', 'Show_E01 EP03.txt'])
      expect(readFileSync(join(dir, 'parts', 'Show_E01 EP02.txt'), 'utf8').split('\r\n')[0]).toBe('Episode title (2/3)')
      expect(existsSync(join(dir, 'parts', 'Show_E01.txt'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
