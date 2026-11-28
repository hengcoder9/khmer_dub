import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import type { AdBanner, AdVideo } from '../shared/types'
import { bannerEnable, bannerVisible, mapCuesThroughAds, mapMainTime, planAds } from '../shared/ads'
import { exportEpisode } from '../backend/pipeline/export'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { binPath } from '../backend/lib/paths'
import { DEFAULT_CAPTIONS } from '../shared/captions'

const ad = (at: AdVideo['at'], durationSec: number, everyMin?: number): AdVideo => ({ id: at, path: 'x.mp4', at, everyMin, durationSec, enabled: true })

describe('ad timeline', () => {
  it('pre-roll, mid-rolls every N minutes and post-roll, per part', () => {
    const plan = planAds([{ start: 0, end: 300 }], [ad('start', 5), ad('every', 10, 2), ad('end', 4)])
    expect(plan.pieces.map((p) => (p.kind === 'ad' ? `ad${p.ad}@${p.at}` : `main ${p.from}-${p.to}@${p.at}`))).toEqual([
      'ad0@0',
      'main 0-120@5',
      'ad1@125',
      'main 120-240@135',
      'ad1@255',
      'main 240-300@265',
      'ad2@325'
    ])
    expect(plan.total).toBe(329)
    expect(plan.cuts).toEqual([])
    // a main time moves by every ad before it
    expect(mapMainTime(plan, 0)).toBe(5)
    expect(mapMainTime(plan, 130)).toBe(145)
    expect(mapMainTime(plan, 300)).toBe(325)
  })

  it('no mid-roll right before the end of a part; split parts each get their ads and the cut moves', () => {
    const plan = planAds([{ start: 0, end: 60 }, { start: 60, end: 125 }], [ad('start', 3), ad('every', 2, 1)])
    // 60 s parts with "every 1 min": the stop at 60 s is the end of part 1 → skipped; part 2's stop at 120 s is < 15 s before its end → skipped
    expect(plan.pieces.filter((p) => p.kind === 'ad').length).toBe(2)
    expect(plan.cuts).toEqual([63])
    expect(plan.total).toBe(131)
  })

  it('subtitles move with the ads and never run into an ad break', () => {
    const plan = planAds([{ start: 0, end: 300 }], [ad('start', 5), ad('every', 10, 2)])
    const out = mapCuesThroughAds([{ id: '1', start: 1, end: 2, text: 'a' }, { id: '2', start: 119, end: 121, text: 'b' }], plan)
    expect(out[0]).toMatchObject({ start: 6, end: 7 })
    expect(out[1]).toMatchObject({ start: 124, end: 125 }) // stops where the 120 s ad break starts
  })

  it('banner schedule: always, or for N seconds every M minutes', () => {
    const b: AdBanner = { id: 'b', path: 'b.png', position: 'bottom', size: 0.8, margin: 0.03, opacity: 1, show: 'interval', everyMin: 1, forSec: 10, startSec: 5, enabled: true }
    expect(bannerEnable(b)).toBe('gte(t,5)*lt(mod(t-5,60),10)')
    expect([0, 5, 14, 15, 65, 76].map((t) => bannerVisible(b, t))).toEqual([false, true, true, false, true, false])
    expect(bannerEnable({ ...b, show: 'always' })).toBeNull()
  })
})

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }
const ffprobe = (f: string, entries: string) => spawnSync(binPath('ffprobe').path, ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', f]).stdout.toString().trim()
/** average RGB of a frame at time t */
function rgbAt(f: string, t: number, crop = 'iw:ih:0:0'): [number, number, number] {
  const r = spawnSync(binPath('ffmpeg').path, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${crop},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  const b = r.stdout
  return [b[0], b[1], b[2]]
}

describe('ads in a real export', () => {
  it('video ads per part, banner in its time window, mirrored picture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-ads-'))
    const vid = join(dir, 'src.mp4')
    const red = join(dir, 'red.mp4')
    const banner = join(dir, 'banner.png')
    // main: left half white, right half black (so a mirror is easy to see), 130 s
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=10,drawbox=x=0:y=0:w=160:h=180:color=white:t=fill', '-f', 'lavfi', '-i', 'sine=sample_rate=22050', '-t', '130', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', vid])
    // a 2 s pure red ad with no sound, in another size (gets letterboxed)
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red:size=200x200:rate=25', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', red])
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x00ff00:size=300x40', '-frames:v', '1', banner])
    try {
      const r = await exportEpisode(
        {
          videoPath: vid, epDir: dir, durationSec: 130, width: 320, height: 180, outDir: join(dir, 'out'), baseName: 'x_E01',
          cues: [{ id: '1', start: 10, end: 12, text: 'hello' }], captions: DEFAULT_CAPTIONS, captionLang: 'km', burn: false,
          outputs: { mp4: true, srt: true, vtt: false, ass: false }, encoder: 'cpu', fps: 10, splitMinutes: 1,
          flip: { h: true },
          ads: {
            videos: [{ id: 'a', path: red, at: 'start', durationSec: 2, enabled: true }],
            banners: [{ id: 'b', path: banner, position: 'top', size: 0.9, margin: 0, opacity: 1, show: 'interval', everyMin: 1, forSec: 10, startSec: 20, enabled: true }]
          }
        },
        ctx
      )
      const mp4s = r.files.filter((f) => f.endsWith('.mp4'))
      expect(mp4s.map((f) => basename(f))).toEqual(['x_E01 EP01.mp4', 'x_E01 EP02.mp4'])
      // each part = 2 s ad + its main part (60 s + 70 s)
      const lens = mp4s.map((f) => Number(ffprobe(f, 'format=duration')))
      expect(lens[0]).toBeGreaterThan(61.5)
      expect(lens[0]).toBeLessThan(62.6)
      expect(lens[1]).toBeGreaterThan(71.5)
      expect(lens[1]).toBeLessThan(72.6)
      for (const f of mp4s) {
        // first second: the red ad
        const [cr, cg, cb] = rgbAt(f, 0.8, '100:100:110:40')
        expect(cr).toBeGreaterThan(180)
        expect(cg + cb).toBeLessThan(120)
      }
      // after the ad: mirrored main picture (white moved to the right half)
      const left = rgbAt(mp4s[0], 5, '140:100:10:60')
      const right = rgbAt(mp4s[0], 5, '140:100:170:60')
      expect(left[0]).toBeLessThan(60)
      expect(right[0]).toBeGreaterThan(200)
      // banner: green strip at the top only between 20 s and 30 s of the main video (= 22–32 s in EP01)
      const topAt = (t: number) => rgbAt(mp4s[0], t, '200:20:60:5')
      expect(topAt(25)[1]).toBeGreaterThan(200)
      expect(topAt(25)[0]).toBeLessThan(80)
      expect(topAt(15)[1]).toBeLessThan(160) // not shown yet (black/white picture under it)
      // the subtitle moved by the 2 s ad
      const srt = r.files.find((f) => f.endsWith('EP01.srt'))!
      expect(require('node:fs').readFileSync(srt, 'utf8')).toContain('00:00:12,000 --> 00:00:14,000')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)
})
