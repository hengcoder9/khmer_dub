import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { exportEpisode } from '../backend/pipeline/export'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { binPath } from '../backend/lib/paths'
import { DEFAULT_CAPTIONS } from '../shared/captions'

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }
const frames = (f: string) => Number(spawnSync(binPath('ffprobe').path, ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', f]).stdout.toString().trim())

describe('export with a still (not animated) logo', () => {
  // regression: the logo was a single frame and overlay shortest=1 ended the whole video after frame 1,
  // so the export froze on one picture and "split into episodes" produced just one part
  it('keeps every video frame and still splits into parts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-logo-'))
    const vid = join(dir, 'src.mp4')
    const logo = join(dir, 'logo.png')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x568:rate=10', '-f', 'lavfi', '-i', 'sine=sample_rate=22050', '-t', '150', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', vid])
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red@0.8:size=100x40,format=rgba', '-frames:v', '1', logo])
    try {
      const r = await exportEpisode(
        {
          videoPath: vid, epDir: dir, durationSec: 150, width: 320, height: 568, outDir: join(dir, 'out'), baseName: 'x_E01',
          cues: [], captions: DEFAULT_CAPTIONS, captionLang: 'km', burn: true,
          outputs: { mp4: true, srt: false, vtt: false, ass: false }, encoder: 'cpu', fps: 10, splitMinutes: 1,
          watermark: { path: logo, position: 'tr', size: 0.15, opacity: 0.85, margin: 0.03, animation: 'none', text: 'Heng Movie' }
        },
        ctx
      )
      const mp4s = r.files.filter((f) => f.endsWith('.mp4'))
      expect(mp4s.map((f) => basename(f))).toEqual(['x_E01 EP01.mp4', 'x_E01 EP02.mp4', 'x_E01 EP03.mp4']) // 60 + 60 + 30 s
      const total = mp4s.map(frames).reduce((a, b) => a + b, 0)
      expect(total).toBeGreaterThan(1450) // 150 s × 10 fps, not 1 frozen frame
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
