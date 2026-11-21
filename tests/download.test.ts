import { describe, expect, it } from 'vitest'
import { resolveLink } from '../backend/pipeline/download'
import { downloadArgs, formatFor, infoArgs, parseLine, summarizeInfo, validateUrl } from '../backend/pipeline/ytdlp'

describe('Import Link', () => {
  it('refuses streaming / VIP services', () => {
    for (const u of ['https://www.iq.com/play/abc', 'https://wetv.vip/en/play/x', 'https://v.qq.com/x/cover/1.html', 'https://hongguoduanju.com/x', 'https://www.dramaboxapp.com/drama/1', 'https://www.goodshort.com/episodes/1'])
      expect(() => resolveLink(u)).toThrow(/streaming \/ VIP/)
  })
  it('sends video pages and stream playlists to yt-dlp', () => {
    expect(resolveLink('https://www.youtube.com/watch?v=abc').kind).toBe('page')
    expect(resolveLink('https://www.tiktok.com/@me/video/1').kind).toBe('page')
    expect(resolveLink('https://cdn.example.com/a/index.m3u8').kind).toBe('page')
  })
  it('refuses bad links', () => {
    expect(() => resolveLink('not a link')).toThrow(/valid link/)
    expect(() => resolveLink('ftp://x/y.mp4')).toThrow(/http/)
  })
  it('turns share links into downloads', () => {
    expect(resolveLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing')).toEqual({
      url: 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMn&export=download&confirm=t',
      kind: 'gdrive'
    })
    expect(resolveLink('https://www.dropbox.com/scl/fi/xyz/ep1.mp4?rlkey=k&dl=0').url).toBe('https://www.dropbox.com/scl/fi/xyz/ep1.mp4?rlkey=k&dl=1')
    expect(resolveLink('https://files.example.com/ep01.mp4').kind).toBe('direct')
  })
})

describe('yt-dlp', () => {
  it('validates urls', () => {
    expect(validateUrl(' https://youtu.be/x ')).toBe('https://youtu.be/x')
    expect(validateUrl('file:///c:/x.mp4')).toBeNull()
    expect(validateUrl('--exec calc')).toBeNull()
  })
  it('builds format strings and keeps the url after --', () => {
    expect(formatFor('best')).toBe('bv*+ba/b')
    expect(formatFor('720')).toBe('bv*[height<=720]+ba/b[height<=720]/b')
    const a = downloadArgs('https://youtu.be/x', '1080', 'D:\out')
    expect(a.slice(-2)).toEqual(['--', 'https://youtu.be/x'])
    expect(a).toContain('--no-playlist')
    expect(a[a.indexOf('--merge-output-format') + 1]).toBe('mp4')
    expect(infoArgs('https://youtu.be/x', true)).toContain('--yes-playlist')
  })
  it('parses progress, file and errors', () => {
    expect(parseLine('KDPROG downloading|1048576|NA|4194304|524288|6|NA|NA')).toMatchObject({ type: 'progress', downloaded: 1048576, total: 4194304, speed: 524288, eta: 6 })
    expect(parseLine('KDFILE D:\p\Ep 1 [x] 1080p.mp4')).toEqual({ type: 'file', path: 'D:\p\Ep 1 [x] 1080p.mp4' })
    expect(parseLine('[info] x: Downloading 1 format(s): 137+140')).toEqual({ type: 'parts', count: 2 })
    expect(parseLine('ERROR: [youtube] x: Video unavailable')).toEqual({ type: 'error', message: '[youtube] x: Video unavailable' })
    expect(parseLine('random noise')).toBeNull()
  })
  it('summarizes videos and playlists', () => {
    const v = summarizeInfo({ id: 'x', title: 'Ep 1', duration: 60, extractor_key: 'Youtube', formats: [{ vcodec: 'avc1', height: 720 }, { vcodec: 'avc1', height: 1080 }, { vcodec: 'none' }] })
    expect(v).toMatchObject({ type: 'video', title: 'Ep 1', heights: [1080, 720], site: 'Youtube' })
    const p = summarizeInfo({ _type: 'playlist', title: 'S1', entries: [{ url: 'https://youtu.be/a', title: 'A' }, { url: 'not-a-url' }, { url: 'https://youtu.be/b', playlist_index: 5 }] })
    expect(p).toMatchObject({ type: 'playlist', count: 2, entries: [{ index: 1, title: 'A' }, { index: 5, title: '#3' }] })
  })
})
