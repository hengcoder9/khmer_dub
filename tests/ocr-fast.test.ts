import { describe, expect, it, vi } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { fontsDir } from '../backend/lib/paths'
import { keyPool } from '../backend/lib/keys'
import { planReads } from '../shared/ocrtiming'

const SUBS = [
  { start: 1.3, end: 4.7, text: 'Where are you going?' },
  { start: 4.7, end: 8.2, text: 'Home. It is late.' },
  { start: 12.1, end: 15.5, text: 'Wait for me!' }
]
const truth = (t: number) => SUBS.find((s) => t >= s.start && t < s.end)?.text ?? ''

// stand-in AI: answers every frame it is sent with the real subtitle at that time
let framesSent = 0
vi.mock('../backend/lib/llm', () => ({
  llmJson: vi.fn(async (o: { parts: Array<{ text?: string }> }) => {
    const ts = o.parts.map((p) => /^Frame t=([\d.]+)/.exec(p.text ?? '')?.[1]).filter(Boolean).map(Number)
    framesSent += ts.length
    return ts.map((t) => ({ t, text: truth(t) }))
  })
}))
const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

describe('fast read screen', () => {
  it('plan: repeats of the same subtitle (or of no subtitle) are not sent', () => {
    const pic = (on: number[]) => {
      const a = new Uint8Array(100)
      on.forEach((k) => (a[k] = 1))
      return a
    }
    const A = pic([...Array(40).keys()])
    const A2 = pic([...Array(38).keys(), 60, 61]) // same subtitle, a little background noise
    const B = pic([...Array(40).keys()].map((k) => k + 50)) // another subtitle
    const none = pic([3, 70])
    const p = planReads([0, 1, 2, 3, 4, 5, 6], [none, none, A, A2, A, B, none])
    expect(p.skipping).toBe(true)
    expect(p.send).toEqual([0, 2, 5, 6])
    expect([...p.same]).toEqual([[1, 0], [3, 2], [4, 2]])
  })

  it('no steady-text pictures: everything is read (nothing lost)', () => {
    expect(planReads([0, 1, 2], []).send).toEqual([0, 1, 2])
  })

  it('real video: far fewer frames to the AI, same lines and exact timing', async () => {
    const { readScreen } = await import('../backend/pipeline/ocr')
    const dir = mkdtempSync(join(tmpdir(), 'kd-ocrfast-'))
    keyPool.set([{ id: 'g', provider: 'gemini', key: 'x' }])
    try {
      const ts = (s: number) => `0:00:${s.toFixed(2).padStart(5, '0')}`
      writeFileSync(
        join(dir, 's.ass'),
        [
          '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 640', 'PlayResY: 360', '', '[V4+ Styles]',
          'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
          'Style: D,Kantumruy Pro,26,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1,2,20,20,18,1',
          '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
          ...SUBS.map((s) => `Dialogue: 0,${ts(s.start)},${ts(s.end)},D,,0,0,0,,${s.text}`)
        ].join('\n'),
        'utf8'
      )
      mkdirSync(join(dir, 'fonts'))
      for (const f of readdirSync(fontsDir)) if (f.endsWith('.ttf')) copyFileSync(join(fontsDir, f), join(dir, 'fonts', f))
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25,noise=alls=25:allf=t', '-t', '20', '-vf', 'subtitles=s.ass:fontsdir=fonts', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', 'v.mp4'], { cwd: dir })

      const r = await readScreen({ videoPath: join(dir, 'v.mp4'), epDir: dir, durationSec: 20, interval: 0.5, cropTop: 0.75, region: { top: 0.75, bottom: 1 }, geminiModel: 'g', provider: 'gemini' }, ctx)
      // 40 sampled frames over a deliberately noisy picture: well under two thirds go to the AI
      if (process.env.KD_SHOW) console.log('SENT', framesSent, 'of 40')
      expect(framesSent).toBeLessThanOrEqual(26)

      // a calmer scene (dark picture, light film grain), like most drama shots behind subtitles
      framesSent = 0
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x2a2a35:size=640x360:rate=25,noise=alls=8:allf=t', '-t', '20', '-vf', 'subtitles=s.ass:fontsdir=fonts', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', 'calm.mp4'], { cwd: dir })
      const c = await readScreen({ videoPath: join(dir, 'calm.mp4'), epDir: dir, durationSec: 20, interval: 0.5, cropTop: 0.75, region: { top: 0.75, bottom: 1 }, geminiModel: 'g', provider: 'gemini' }, ctx)
      if (process.env.KD_SHOW) console.log('CALM SENT', framesSent, 'of 40')
      expect(c.segments.map((x) => x.text)).toEqual(SUBS.map((x) => x.text))
      expect(framesSent).toBeLessThanOrEqual(10)
      expect(r.segments.map((s) => s.text)).toEqual(SUBS.map((s) => s.text))
      r.segments.forEach((s, i) => {
        expect(Math.abs(s.start - SUBS[i].start)).toBeLessThanOrEqual(0.15)
        expect(Math.abs(s.end - SUBS[i].end)).toBeLessThanOrEqual(0.15)
      })
    } finally {
      keyPool.set([])
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
