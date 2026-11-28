import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanBand } from '../backend/pipeline/ocr'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { fontsDir } from '../backend/lib/paths'
import { mergeReadings, refineWithScan } from '../shared/ocrtiming'

// subtitles burned in at these exact times (the "truth")
const SUBS = [
  { start: 1.3, end: 3.7, text: 'Where are you going?' },
  { start: 3.7, end: 6.2, text: 'Home. It is late.' },
  { start: 8.1, end: 9.5, text: 'Wait for me!' }
]
const ts = (s: number) => `0:00:${s.toFixed(2).padStart(5, '0')}`

describe('read screen timing on a real video', () => {
  it('every line starts and ends within 0.15 s of the real subtitle (1 s samples)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-ocrscan-'))
    try {
      const ass = [
        '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 640', 'PlayResY: 360', '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: D,Kantumruy Pro,26,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1,2,20,20,18,1',
        '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ...SUBS.map((s) => `Dialogue: 0,${ts(s.start)},${ts(s.end)},D,,0,0,0,,${s.text}`)
      ].join('\n')
      writeFileSync(join(dir, 's.ass'), ass, 'utf8')
      const fonts = join(dir, 'fonts')
      require('node:fs').mkdirSync(fonts)
      for (const f of readdirSync(fontsDir)) if (f.endsWith('.ttf')) copyFileSync(join(fontsDir, f), join(fonts, f))
      // a busy, moving picture behind the text (so the scan must ignore the background)
      const r = await runFfmpeg(
        ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25,noise=alls=25:allf=t', '-t', '11', '-vf', 'subtitles=s.ass:fontsdir=fonts', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', 'v.mp4'],
        { cwd: dir }
      )
      expect(r.code).toBe(0)

      const scan = await scanBand(join(dir, 'v.mp4'), 0.75, 0.25)
      expect(scan.length).toBeGreaterThan(100)
      // what the AI would read on frames sampled every second
      const readings = Array.from({ length: 11 }, (_, t) => ({ t, text: SUBS.find((s) => t >= s.start && t < s.end)?.text ?? '' }))
      const lines = refineWithScan(mergeReadings(readings, 1), scan, 1, 11)
      expect(lines.map((l) => l.text)).toEqual(SUBS.map((s) => s.text))
      if (process.env.KD_SHOW) console.log(JSON.stringify(lines.map((l, i) => ({ text: l.text, start: l.start, real: SUBS[i].start, end: l.end, realEnd: SUBS[i].end }))))
      lines.forEach((l, i) => {
        expect(Math.abs(l.start - SUBS[i].start)).toBeLessThanOrEqual(0.15)
        expect(Math.abs(l.end - SUBS[i].end)).toBeLessThanOrEqual(0.15)
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
