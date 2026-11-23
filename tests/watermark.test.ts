import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Watermark } from '../shared/types'
import { assAlpha, withWatermarkText, wmLogoPulse, wmOverlayXY, wmTextAss } from '../shared/watermark'
import { DEFAULT_CAPTIONS, toAss } from '../shared/captions'

vi.mock('../backend/pipeline/tts', () => ({
  previewVoice: async (p: { outDir: string }) => {
    const { runFfmpeg } = await import('../backend/lib/ffmpeg')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(p.outDir, { recursive: true })
    const out = join(p.outDir, 'v.wav')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=24000', '-t', '2', out])
    return out
  }
}))
const { exportEpisode } = await import('../backend/pipeline/export')
const { renderStory } = await import('../backend/pipeline/story')
const { runFfmpeg, probeMedia } = await import('../backend/lib/ffmpeg')

const base: Watermark = { path: '', position: 'tr', size: 0.2, opacity: 0.8, margin: 0.03, text: '@KhmerDub', textColor: '#FFD700', textSize: 0.05, every: 4 }
const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

describe('watermark planning', () => {
  it('logo positions are quoted ffmpeg expressions (commas must not split the graph)', () => {
    expect(wmOverlayXY({ ...base, animation: 'none' }, 20)).toBe("x='W-w-20':y='20'")
    expect(wmOverlayXY({ ...base, animation: 'corners' }, 20)).toBe("x='if(eq(mod(floor(t/4),4),0)+eq(mod(floor(t/4),4),3),20,W-w-20)':y='if(lt(mod(floor(t/4),4),2),20,H-h-20)'")
    expect(wmOverlayXY({ ...base, animation: 'scroll', position: 'bl' }, 20)).toBe("x='W-mod(t*(W+w)/4,W+w)':y='H-h-20'")
    expect(wmOverlayXY({ ...base, animation: 'float' }, 20)).toMatch(/^x='W-w-20\+min\(20,W\*0\.02\)\*sin\(2\*PI\*t\/4\)':y='20\+/)
    expect(wmLogoPulse({ ...base, animation: 'pulse' })).toMatch(/a='alpha\(X,Y\)\*\(0\.675\+0\.325\*cos\(2\*PI\*T\/4\)\)'/)
    expect(wmLogoPulse({ ...base, animation: 'corners' })).toBeNull()
  })

  it('text events per animation', () => {
    const ev = (a: Watermark['animation']) => wmTextAss({ ...base, animation: a }, 720, 1280, 12, 'Kantumruy Pro')!.events
    expect(ev('none')).toHaveLength(1)
    expect(ev('corners').map((e) => e.match(/\\an(\d)/)![1])).toEqual(['7', '9', '3']) // 12 s / 4 s, tl → tr → br
    expect(ev('scroll')[0]).toMatch(/\\an1\\move\(720,/)
    expect(ev('pulse')[0]).toContain(`\\t(0,2000,\\alpha${assAlpha(0.8 * 0.35)})`)
    expect(ev('float')).toHaveLength(6) // out and back per cycle
    expect(wmTextAss({ ...base, text: '  ' }, 720, 1280, 12, 'F')).toBeNull()
  })

  it('moves the text away from the logo by the given offset', () => {
    const plain = wmTextAss({ ...base, animation: 'none' }, 720, 1280, 5, 'F')!.style.split(',')
    const below = wmTextAss({ ...base, animation: 'none' }, 720, 1280, 5, 'F', 100)!.style.split(',')
    expect(Number(below[21]) - Number(plain[21])).toBe(100) // MarginV
    expect(plain[18]).toBe('9') // top right
    expect(withWatermarkText(toAss([], DEFAULT_CAPTIONS, 720, 1280), { ...base }, 720, 1280, 5, 'F')).toMatch(/Style: WM,F,/)
  })
})

describe('watermark rendering', () => {
  it('text-only corners watermark: top-left at 1 s, top-right at 5 s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-wm-'))
    const vid = join(dir, 'src.mp4')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x223344:size=360x640:rate=10', '-f', 'lavfi', '-i', 'sine=sample_rate=22050', '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', vid])
    try {
      const r = await exportEpisode(
        {
          videoPath: vid, epDir: join(dir, 'ep'), durationSec: 8, width: 360, height: 640, cues: [], captions: DEFAULT_CAPTIONS, captionLang: 'km', burn: false,
          outputs: { mp4: true, srt: false, vtt: false, ass: false }, encoder: 'cpu', outDir: join(dir, 'out'), baseName: 'wm',
          watermark: { ...base, textSize: 0.08, opacity: 1, animation: 'corners', position: 'tl' }
        },
        ctx
      )
      // brightness of the top-left and top-right corner patches (the text is bright yellow on a dark frame)
      const patch = async (t: number, x: string) => {
        const out = join(dir, `p${t}${x}.raw`)
        await runFfmpeg(['-y', '-ss', String(t), '-i', r.files[0], '-frames:v', '1', '-vf', `crop=100:45:${x}:8`, '-f', 'rawvideo', '-pix_fmt', 'gray', out])
        const b = readFileSync(out)
        return b.reduce((s, v) => s + v, 0) / b.length
      }
      const [tl1, tr1, tl5, tr5] = [await patch(1, '0'), await patch(1, 'iw-100'), await patch(5, '0'), await patch(5, 'iw-100')]
      expect(tl1 - tr1).toBeGreaterThan(3)
      expect(tr5 - tl5).toBeGreaterThan(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('Claude Video gets the logo + text watermark and background music', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-wms-'))
    const logo = join(dir, 'logo.png')
    const music = join(dir, 'music.wav')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0xff3355:size=200x80', '-frames:v', '1', logo])
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=44100', '-t', '1.5', music])
    try {
      const r = await renderStory(
        {
          plan: { title: 'T', description: '', hashtags: [], scenes: [{ narration: 'សួស្តី', title: 'ក', colors: ['#000000', '#333333'], shot: '' }] },
          aspect: '9:16', background: 'colors', musicPath: music, voiceId: 'default:female', defaultMale: 'm', defaultFemale: 'f',
          captions: DEFAULT_CAPTIONS, lang: 'km', outDir: join(dir, 'out'), name: 'wm story',
          watermark: { ...base, path: logo, animation: 'pulse' }
        },
        ctx
      )
      const info = await probeMedia(r.files[0])
      expect(info.video).toMatchObject({ width: 720, height: 1280 })
      expect(info.audio).toBeTruthy()
      expect(info.durationSec).toBeCloseTo(2.8, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
