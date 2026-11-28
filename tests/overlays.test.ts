import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { exportEpisode } from '../backend/pipeline/export'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { binPath } from '../backend/lib/paths'
import { DEFAULT_CAPTIONS } from '../shared/captions'
import { TEXT_STYLES, TEXT_STYLE_IDS, textCss, textOverlayAss, type Overlay } from '../shared/overlays'

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }
/** average RGB of a region at time t */
function rgb(f: string, t: number, crop: string): [number, number, number] {
  const r = spawnSync(binPath('ffmpeg').path, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${crop},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  return [r.stdout[0], r.stdout[1], r.stdout[2]]
}

describe('text styles', () => {
  it('16 styles, each with an ASS style and a matching preview', () => {
    expect(TEXT_STYLE_IDS).toHaveLength(16)
    for (const id of TEXT_STYLE_IDS) {
      const css = textCss(TEXT_STYLES[id], 40)
      expect(css.color).toBe(TEXT_STYLES[id].fill)
    }
    const a = textOverlayAss(
      [{ id: 'x', kind: 'text', text: 'ស្វាគមន៍ {hi}', style: 'neonPink', size: 0.1, x: 0.5, y: 0.25, start: 0, end: 2, anim: 'pop', opacity: 1, windows: [{ start: 1, end: 3 }] }],
      1280,
      720,
      'Kantumruy Pro'
    )
    expect(a.styles[0]).toMatch(/^Style: Ov0,Kantumruy Pro,72,/)
    expect(a.events).toHaveLength(2) // glow layer + text
    expect(a.events[1]).toContain('{\\an5\\pos(640,180)\\fscx40\\fscy40')
    expect(a.events[1]).toContain('ស្វាគមន៍ hi') // braces stripped
  })
})

describe('stickers and text in a real export', () => {
  it('each overlay shows only in its window, where it was put; cuts move it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-ov-'))
    try {
      const vid = join(dir, 'v.mp4')
      const png = join(dir, 's.png')
      const gif = join(dir, 'g.gif')
      const clip = join(dir, 'c.mp4')
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x202020:size=640x360:rate=10', '-f', 'lavfi', '-i', 'sine=sample_rate=22050', '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', vid])
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red:size=100x100', '-frames:v', '1', png])
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=lime:size=80x80:rate=5', '-t', '1', gif])
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=blue:size=80x80:rate=10', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clip])
      const overlays: Overlay[] = [
        { id: 'a', kind: 'sticker', path: png, name: 'red', start: 1, end: 3, x: 0.2, y: 0.25, w: 0.2, anim: 'pop', opacity: 1 },
        { id: 'b', kind: 'sticker', path: gif, name: 'gif', start: 2, end: 5, x: 0.8, y: 0.25, w: 0.15, anim: 'none', opacity: 1 },
        { id: 'c', kind: 'sticker', path: clip, name: 'vid', start: 4, end: 6, x: 0.5, y: 0.8, w: 0.15, anim: 'fade', opacity: 1 },
        { id: 'd', kind: 'text', text: 'ស្វាគមន៍', style: 'highlight', size: 0.12, x: 0.5, y: 0.5, start: 3, end: 5, anim: 'none', opacity: 1 }
      ]
      const base = {
        videoPath: vid, epDir: dir, durationSec: 8, width: 640, height: 360, cues: [], captions: DEFAULT_CAPTIONS, captionLang: 'km', burn: false,
        outputs: { mp4: true, srt: false, vtt: false, ass: false }, encoder: 'cpu' as const, fps: 10, overlays
      }
      const r = await exportEpisode({ ...base, outDir: join(dir, 'o'), baseName: 'x' }, ctx)
      const f = r.files[0]
      const red = (t: number) => rgb(f, t, '60:40:98:70')
      const lime = (t: number) => rgb(f, t, '40:40:492:70')
      const blue = (t: number) => rgb(f, t, '40:30:300:270')
      const mid = (t: number) => rgb(f, t, '120:30:260:165') // the yellow "highlight" box
      expect(red(0.5)[0]).toBeLessThan(60)
      expect(red(2)[0]).toBeGreaterThan(200)
      expect(red(3.5)[0]).toBeLessThan(60)
      expect(lime(1.5)[1]).toBeLessThan(60)
      expect(lime(3)[1]).toBeGreaterThan(200)
      expect(lime(5.5)[1]).toBeLessThan(60)
      expect(blue(3.5)[2]).toBeLessThan(60)
      expect(blue(5)[2]).toBeGreaterThan(200)
      expect(blue(6.5)[2]).toBeLessThan(60)
      expect(mid(2.5)[0]).toBeLessThan(60)
      const y = mid(4)
      expect(y[0] + y[1]).toBeGreaterThan(300) // yellow box with the Khmer text

      // cut the first 2 s out: the red sticker (1–3 s) now shows 0–1 s of the output
      const cut = await exportEpisode(
        { ...base, outDir: join(dir, 'c'), baseName: 'c', edit: { clips: [{ id: 'k', start: 2, end: 8 }], aspect: 'source', fitMode: 'crop', fadeIn: 0, fadeOut: 0 } },
        ctx
      )
      const cf = cut.files[0]
      expect(rgb(cf, 0.5, '60:40:98:70')[0]).toBeGreaterThan(200)
      expect(rgb(cf, 1.5, '60:40:98:70')[0]).toBeLessThan(60)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)
})

import { STICKER_ART } from '../shared/stickerArt'

/** well-formed enough to render: every tag closed in order, attributes quoted */
function xmlOk(s: string): string | null {
  const stack: string[] = []
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|<|>/g
  let m: RegExpExecArray | null
  let last = 0
  while ((m = re.exec(s))) {
    if (!m[2]) return `stray "${m[0]}" at ${m.index}`
    if (s.slice(last, m.index).includes('<')) return `bad tag near ${m.index}`
    last = re.lastIndex
    if (m[1]) {
      if (stack.pop() !== m[2]) return `</${m[2]}> closes the wrong tag`
    } else if (!m[4]) stack.push(m[2])
  }
  return stack.length ? `unclosed <${stack.join('>, <')}>` : null
}

describe('built-in stickers', () => {
  it('every sticker is valid SVG with its size', () => {
    expect(STICKER_ART.length).toBeGreaterThanOrEqual(25)
    expect(new Set(STICKER_ART.map((a) => a.id)).size).toBe(STICKER_ART.length)
    for (const a of STICKER_ART) {
      expect(xmlOk(a.svg), a.id).toBeNull()
      expect(a.svg, a.id).toContain(`viewBox="0 0 ${a.w} ${a.h}"`)
    }
  })
})
