import { describe, expect, it } from 'vitest'
import { resolveLink } from '../backend/pipeline/download'

describe('Import Link', () => {
  it('refuses streaming / VIP services', () => {
    for (const u of ['https://www.iq.com/play/abc', 'https://wetv.vip/en/play/x', 'https://v.qq.com/x/cover/1.html', 'https://hongguoduanju.com/x', 'https://www.dramaboxapp.com/drama/1', 'https://www.goodshort.com/episodes/1'])
      expect(() => resolveLink(u)).toThrow(/streaming \/ VIP/)
  })
  it('sends platform pages to their own download', () => {
    expect(() => resolveLink('https://www.youtube.com/watch?v=abc')).toThrow(/YouTube Studio/)
  })
  it('refuses stream playlists and bad links', () => {
    expect(() => resolveLink('https://cdn.example.com/a/index.m3u8')).toThrow(/HLS/)
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
