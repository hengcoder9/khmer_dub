import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { findImage, imageBody, makeThumbnails, thumbAss, thumbPrompt } from '../backend/pipeline/thumbnail'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { binPath } from '../backend/lib/paths'

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }
const size = (f: string) =>
  spawnSync(binPath('ffprobe').path, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).stdout.toString().trim()

describe('thumbnail planning', () => {
  it('asks the image model for a text-free picture that keeps the characters', () => {
    const p = thumbPrompt({ aspect: '16:9', scene: 'a woman slaps a man at a wedding' }, 1, 3)
    expect(p).toMatch(/YouTube thumbnail \(16:9\)/)
    expect(p).toMatch(/SAME characters/)
    expect(p).toMatch(/Do NOT draw any text/)
    expect(p).toMatch(/Variation 2/)
    const b = imageBody('m', 'x', [{ data: 'AAA', mime: 'image/jpeg' }], '9:16')
    expect(b.response_format).toEqual({ type: 'image', aspect_ratio: '9:16', image_size: '2K' })
    expect(b.input[1]).toEqual({ type: 'image', mime_type: 'image/jpeg', data: 'AAA' })
  })

  it('finds the generated picture, never the echoed input', () => {
    expect(findImage({ output_image: { data: 'OUT' } })?.data).toBe('OUT')
    const it = { input: [{ type: 'image', data: 'IN' }], steps: [{ type: 'model_output', content: [{ type: 'text', text: 'hi' }, { type: 'image', data: 'GEN' }] }] }
    expect(findImage(it)?.data).toBe('GEN')
    expect(findImage({ input: [{ type: 'image', data: 'IN' }], status: 'completed' })).toBeNull()
  })

  it('title ASS: big outlined title at the bottom, tag box top-left, braces stripped', () => {
    const a = thumbAss({ title: 'ប្ដីក្បត់ {ចិត្ត}', tag: 'EP 01', color: '#FFD400' }, 1280, 720)
    expect(a).toContain('PlayResX: 1280')
    expect(a).toMatch(/Style: Title,Kantumruy Pro,94,&H0000D4FF/)
    expect(a).toContain('Title,,0,0,0,,ប្ដីក្បត់ ចិត្ត')
    expect(a).toContain('Tag,,0,0,0,,EP 01')
  })
})

describe('thumbnail rendering', () => {
  it('video frame mode: picture at the moment, filled to 16:9 / 9:16, Khmer title burned, clean copy kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-thumb-'))
    const vid = join(dir, 'src.mp4')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=10', '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', vid])
    try {
      const r = await makeThumbnails(
        { videoPath: vid, durationSec: 6, times: [1, 4], mode: 'frame', aspect: '16:9', title: 'ប្ដីក្បត់ចិត្ត ប្រពន្ធសងសឹក', tag: 'EP 01', count: 2, outDir: join(dir, 'out'), name: 'x E01 thumbnail' },
        ctx
      )
      expect(r.files.map((f) => f.replace(/^.*[\\/]/, ''))).toEqual(['x E01 thumbnail 1.jpg', 'x E01 thumbnail 2.jpg'])
      expect(r.clean).toHaveLength(2)
      for (const f of [...r.files, ...r.clean]) expect(size(f)).toBe('1280,720')
      const v = await makeThumbnails({ videoPath: vid, times: [], durationSec: 6, mode: 'frame', aspect: '9:16', title: '', count: 1, outDir: join(dir, 'out'), name: 'tall' }, ctx)
      expect(size(v.files[0])).toBe('1080,1920')
      expect(v.clean).toEqual([]) // no text → no separate clean copy
      expect(existsSync(v.files[0])).toBe(true)
      if (process.env.KD_KEEP) console.log('kept', r.files[0])
    } finally {
      if (!process.env.KD_KEEP) rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
