import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { exportEpisode, type ExportPayload } from '../backend/pipeline/export'
import { runFfmpeg, runFfprobe } from '../backend/lib/ffmpeg'
import { DEFAULT_CAPTIONS } from '../shared/captions'

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }
const dur = async (f: string) => Number((await runFfprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f])).stdout.trim())

describe('export split into episodes', () => {
  for (const burn of [true, false]) {
    it(`splits a 3.5 min video into 1-minute parts (${burn ? 're-encode' : 'copy'} path)`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'kd-split-'))
      const vid = join(dir, 'src.mp4')
      const outDir = join(dir, 'out')
      // keyframe every 5 s so the copy path can cut near each minute
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=22050', '-t', '210', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-c:a', 'aac', '-shortest', vid])
      const cues = Array.from({ length: 70 }, (_, i) => ({ start: i * 3, end: i * 3 + 2.5, text: `line ${i}` }))
      const base = 'រឿង E01'
      const payload: ExportPayload = {
        videoPath: vid, epDir: join(dir, 'ep'), durationSec: 210, width: 160, height: 120, outDir, baseName: base,
        cues, captions: DEFAULT_CAPTIONS, captionLang: 'km', burn,
        outputs: { mp4: true, srt: true, vtt: false, ass: false }, encoder: 'cpu', splitMinutes: 1
      }
      try {
        const res = await exportEpisode(payload, ctx)
        const mp4s = res.files.filter((f) => f.endsWith('.mp4'))
        expect(mp4s.map((f) => basename(f))).toEqual([1, 2, 3, 4].map((n) => `${base} EP0${n}.mp4`))
        expect(existsSync(join(outDir, `${base}.mp4`))).toBe(false) // full video replaced by the parts
        expect(readdirSync(outDir).some((f) => f.startsWith('_kd_part_'))).toBe(false)
        const lens = await Promise.all(mp4s.map(dur))
        expect(lens.reduce((a, b) => a + b, 0)).toBeCloseTo(210, 0)
        if (burn) lens.slice(0, 3).forEach((l) => expect(Math.abs(l - 60)).toBeLessThan(3)) // forced keyframes: near-exact
        // each part has its own SRT starting near 0
        const srt2 = readFileSync(join(outDir, `${base} EP02.srt`), 'utf8')
        expect(srt2).toMatch(/^1\r?\n00:00:0\d,\d{3} -->/)
        expect(res.files.filter((f) => f.endsWith('.srt'))).toHaveLength(4)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }, 120_000)
  }
})
