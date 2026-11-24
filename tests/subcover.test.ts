import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import type { SubCover } from '../shared/types'
import { coverGraph, coverOn, normCover, sourceRect, SUBCOVER_DEFAULT } from '../shared/subcover'
import { exportEpisode } from '../backend/pipeline/export'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { binPath } from '../backend/lib/paths'
const ffmpegPath = () => binPath('ffmpeg').path
import { DEFAULT_CAPTIONS } from '../shared/captions'

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }
const band: SubCover = { enabled: true, x: 0, y: 0.75, w: 1, h: 0.25, mode: 'blur', strength: 3 }

describe('subtitle cover planning', () => {
  it('keeps the box inside the frame', () => {
    const c = normCover({ ...band, x: 0.9, w: 0.5, y: -0.2, h: 0.001, strength: 9, opacity: 3 })
    expect(c.w).toBe(0.5)
    expect(c.x).toBe(0.5)
    expect(c.y).toBe(0)
    expect(c.h).toBe(0.02)
    expect(c.strength).toBe(3)
    expect(c.opacity).toBe(1)
    expect(coverOn({ ...band, enabled: false })).toBe(false)
    expect(coverOn(undefined)).toBe(false)
    expect(coverOn(SUBCOVER_DEFAULT)).toBe(true)
  })

  it('blur: crop → boxblur (radius quoted and capped) → overlay back at the same place', () => {
    const g = coverGraph({ ...band, x: 0.1, w: 0.8, strength: 2 }, '0:V', 'vsrc', 1080)
    expect(g[0]).toBe('[0:V]split=2[scm][scs]')
    expect(g[1]).toBe("[scs]crop=w=iw*0.8000:h=ih*0.2500:x=iw*0.1000:y=ih*0.7500,boxblur=luma_radius='min(h/2-1,26)':luma_power=2:chroma_radius='min(ch/2-1,13)':chroma_power=2[scb]")
    expect(g[2]).toBe('[scm][scb]overlay=x=W*0.1000:y=H*0.7500[vsrc]')
  })

  it('bar: one drawbox with colour and opacity', () => {
    expect(coverGraph({ ...band, mode: 'box', color: '#ff0000', opacity: 0.5 }, 'a', 'b', 720)).toEqual(['[a]drawbox=x=iw*0.0000:y=ih*0.7500:w=iw*1.0000:h=ih*0.2500:color=0xFF0000@0.50:t=fill[b]'])
  })

  it('preview: where the source picture sits in a reframed player', () => {
    expect(sourceRect(16 / 9, 16 / 9, 'contain')).toEqual({ left: 0, top: 0, width: 100, height: 100 })
    // 16:9 in a 9:16 box, letterboxed: full width, centred band
    const c = sourceRect(16 / 9, 9 / 16, 'contain')
    expect(c.width).toBe(100)
    expect(c.height).toBeCloseTo(31.64, 1)
    expect(c.top).toBeCloseTo(34.18, 1)
    // 16:9 in a 9:16 box, cropped: full height, wider than the box
    const k = sourceRect(16 / 9, 9 / 16, 'cover')
    expect(k.height).toBe(100)
    expect(k.width).toBeCloseTo(316.05, 1)
    expect(k.left).toBeCloseTo(-108.02, 1)
  })
})

/** grayscale frame at time t → Uint8Array (w*h) */
function grabGray(file: string, t: number, w: number, h: number): Uint8Array {
  const r = spawnSync(ffmpegPath(), ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { maxBuffer: 1 << 24 })
  return new Uint8Array(r.stdout)
}
/** mean absolute difference between horizontal neighbours in rows [y0, y1) — high for sharp detail, low after a blur */
function detail(px: Uint8Array, w: number, y0: number, y1: number): number {
  let s = 0
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = 1; x < w; x++) (s += Math.abs(px[y * w + x] - px[y * w + x - 1])), n++
  return s / n
}
const mean = (px: Uint8Array, w: number, y0: number, y1: number) => {
  let s = 0
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) s += px[y * w + x]
  return s / ((y1 - y0) * w)
}

describe('subtitle cover rendering', () => {
  it('blurs only the area, also with cuts and a 9:16 reframe; the bar darkens it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-sc-'))
    const vid = join(dir, 'src.mp4')
    // a sharp test pattern everywhere (stands in for burned-in subtitle text)
    // strong pixel noise = sharp detail everywhere, high quality so the encoder keeps it
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10,noise=alls=90:allf=u', '-f', 'lavfi', '-i', 'sine=sample_rate=22050', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-c:a', 'aac', '-shortest', vid])
    const base = {
      videoPath: vid,
      epDir: dir,
      durationSec: 4,
      width: 320,
      height: 180,
      cues: [],
      captions: DEFAULT_CAPTIONS,
      captionLang: 'km',
      burn: false,
      outputs: { mp4: true, srt: false, vtt: false, ass: false },
      encoder: 'cpu' as const,
      fps: 10
    }
    try {
      const W = 320
      const H = 180
      const src = grabGray(vid, 1.5, W, H)
      const plain = await exportEpisode({ ...base, outDir: join(dir, 'plain'), baseName: 'plain', subCover: { ...band, enabled: false } }, ctx)
      const blur = await exportEpisode({ ...base, outDir: join(dir, 'blur'), baseName: 'blur', subCover: band }, ctx)
      const p = grabGray(plain.files[0], 1.5, W, H)
      const b = grabGray(blur.files[0], 1.5, W, H)
      const inArea = [Math.round(H * 0.8), H - 2] as const
      const above = [Math.round(H * 0.1), Math.round(H * 0.6)] as const
      // switched off = unchanged; on = the area loses most of its detail, the rest stays as sharp
      expect(detail(p, W, ...inArea)).toBeGreaterThan(detail(src, W, ...inArea) * 0.8)
      expect(detail(b, W, ...inArea)).toBeLessThan(detail(src, W, ...inArea) * 0.4)
      expect(detail(b, W, ...above)).toBeGreaterThan(detail(src, W, ...above) * 0.8)

      // with cuts + reframe (clip path): still renders, still blurred at the bottom of the source picture
      const edited = await exportEpisode(
        { ...base, outDir: join(dir, 'edit'), baseName: 'edit', subCover: band, edit: { clips: [{ id: 'a', start: 0, end: 1.5 }, { id: 'b', start: 2, end: 4 }], aspect: '16:9', fitMode: 'pad', fadeIn: 0, fadeOut: 0 } },
        ctx
      )
      const e = grabGray(edited.files[0], 0.8, W, H)
      expect(detail(e, W, ...inArea)).toBeLessThan(detail(src, W, ...inArea) * 0.4)
      const tall = await exportEpisode({ ...base, outDir: join(dir, 'tall'), baseName: 'tall', subCover: band, edit: { clips: [], aspect: '9:16', fitMode: 'blur', fadeIn: 0, fadeOut: 0 } }, ctx)
      expect(tall.files[0]).toMatch(/tall\.mp4$/)

      // bar: the area turns (almost) black
      const bar = await exportEpisode({ ...base, outDir: join(dir, 'bar'), baseName: 'bar', subCover: { ...band, mode: 'box', color: '#000000', opacity: 1 } }, ctx)
      const k = grabGray(bar.files[0], 1.5, W, H)
      expect(mean(k, W, ...inArea)).toBeLessThan(25)
      expect(mean(k, W, ...above)).toBeGreaterThan(40)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
