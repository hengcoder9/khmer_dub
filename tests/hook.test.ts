import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { toAss, withHook, DEFAULT_CAPTIONS } from '../shared/captions'
import { exportEpisode } from '../backend/pipeline/export'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { ENGINE_GROUPS } from '../shared/engines'
import { resolveGroups } from '../backend/pipeline/pysetup'

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

describe('AI Creator hook', () => {
  it('adds a top boxed Hook style and a fading event for the first seconds', () => {
    const ass = withHook(toAss([{ start: 0, end: 2, text: 'hi' }], DEFAULT_CAPTIONS, 1080, 1920), 'ពេលនាង {ត្រឡប់} មកវិញ', 'Kantumruy Pro', 1080, 1920)
    const style = ass.split('\n').find((l) => l.startsWith('Style: Hook'))!
    expect(style).toMatch(/^Style: Hook,Kantumruy Pro,81,/) // 7.5% of the short side
    expect(style.split(',')[18]).toBe('8') // alignment: top centre
    expect(ass).toMatch(/Dialogue: 1,0:00:00\.00,0:00:03\.00,Hook,,0,0,0,,\{\\fad\(150,350\)\}ពេលនាង ត្រឡប់ មកវិញ\n$/) // braces stripped
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Default') // captions kept
    expect(withHook('x', '  ', 'F', 100, 100)).toBe('x')
  })

  it('burns the hook even when captions are off (re-encodes a copy-able export)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-hook-'))
    const vid = join(dir, 'src.mp4')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x336699:size=320x568:rate=10', '-f', 'lavfi', '-i', 'sine=sample_rate=22050', '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', vid])
    const base = {
      videoPath: vid, epDir: join(dir, 'ep'), durationSec: 6, width: 320, height: 568, cues: [], captions: DEFAULT_CAPTIONS, captionLang: 'km',
      burn: false, outputs: { mp4: true, srt: false, vtt: false, ass: false }, encoder: 'cpu' as const
    }
    try {
      const withH = await exportEpisode({ ...base, outDir: join(dir, 'a'), baseName: 'hook', hook: 'អ្នកមិនជឿទេ!' }, ctx)
      const noH = await exportEpisode({ ...base, outDir: join(dir, 'b'), baseName: 'plain' }, ctx)
      expect(withH.files.map((f) => basename(f))).toEqual(['hook.mp4'])
      // compare a frame at 1 s: the hook export must differ from the plain one (text drawn), and match it after 3 s
      const frame = async (f: string, t: number, out: string) => {
        // only the top fifth of the frame, where the hook sits, at full width
        await runFfmpeg(['-y', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'crop=iw:ih/5:0:0', '-f', 'rawvideo', '-pix_fmt', 'gray', out])
        const { readFileSync } = await import('node:fs')
        return readFileSync(out)
      }
      const diff = (a: Buffer, b: Buffer) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length
      const h1 = await frame(withH.files[0], 1, join(dir, 'h1.raw'))
      const p1 = await frame(noH.files[0], 1, join(dir, 'p1.raw'))
      const h5 = await frame(withH.files[0], 5, join(dir, 'h5.raw'))
      const p5 = await frame(noH.files[0], 5, join(dir, 'p5.raw'))
      expect(diff(h1, p1)).toBeGreaterThan(3) // hook visible at 1 s
      expect(diff(h5, p5)).toBeLessThan(1.5) // gone after 3 s
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('VoxCPM2 engine group', () => {
  it('is installable after torch, and listed before F5-TTS', () => {
    const ids = ENGINE_GROUPS.map((g) => g.id)
    expect(ids.indexOf('voxcpm')).toBeLessThan(ids.indexOf('clone'))
    expect(resolveGroups(['voxcpm'])).toEqual(['core', 'torch', 'voxcpm'])
  })
})
