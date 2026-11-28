import { describe, expect, it } from 'vitest'
import { assessCopyright, type CopyrightInput } from '../shared/copyright'

const base: CopyrightInput = {
  music: { hasMusic: true, kind: 'score', songs: [], by: 'ai' },
  muteOriginal: false,
  keepOriginal: false,
  autoOriginal: true,
  instrumentalUnderDub: true,
  hasDub: true,
  ownBgm: false,
  licence: false,
  transformed: true
}

describe('copyright check', () => {
  it('source music under the dub and no licence: high everywhere, with fixes', () => {
    const r = assessCopyright(base)
    expect(r.platforms).toEqual({ youtube: 'high', facebook: 'high', tiktok: 'high' })
    expect(r.items.map((i) => i.id)).toEqual(expect.arrayContaining(['instrumental', 'autoOriginal', 'picture']))
    expect(r.items.find((i) => i.id === 'instrumental')!.fix).toBe('muteOriginal')
    expect(r.items[0].level).toBe('high') // worst first
  })

  it('a recognised song is named', () => {
    const r = assessCopyright({ ...base, music: { hasMusic: true, kind: 'song', songs: [{ title: 'Song A', artist: 'Singer B' }], by: 'ai' } })
    const song = r.items.find((i) => i.id === 'song')!
    expect(song.title).toContain('“Song A” by Singer B')
    expect(song.level).toBe('high')
  })

  it('original muted, own music, licence noted: low everywhere', () => {
    const r = assessCopyright({ ...base, muteOriginal: true, ownBgm: true, licence: true })
    expect(r.platforms).toEqual({ youtube: 'low', facebook: 'low', tiktok: 'low' })
    expect(r.items.some((i) => i.id === 'instrumental' || i.id === 'autoOriginal')).toBe(false)
  })

  it('a muted recognised song is no longer a problem', () => {
    const r = assessCopyright({ ...base, muteOriginal: true, licence: true, music: { hasMusic: true, kind: 'song', songs: [{ title: 'X' }], by: 'ai' } })
    expect(r.items.find((i) => i.id === 'song')!.level).toBe('low')
    expect(r.platforms.tiktok).toBe('low')
  })

  it('without the picture licence, TikTok can still be low while YouTube / Facebook are high', () => {
    const r = assessCopyright({ ...base, muteOriginal: true, music: { hasMusic: false, kind: 'none', songs: [], by: 'ai' } })
    expect(r.platforms).toEqual({ youtube: 'high', facebook: 'high', tiktok: 'low' })
  })

  it('no dub and no changes: reused content', () => {
    const r = assessCopyright({ ...base, hasDub: false, transformed: false, muteOriginal: true, licence: true })
    expect(r.items.find((i) => i.id === 'reused')).toBeTruthy()
  })
})
