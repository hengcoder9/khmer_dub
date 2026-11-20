import { describe, expect, it } from 'vitest'
import { isKhmer, mergeListenRead } from '../shared/screenmerge'
import type { RawSeg } from '../shared/segments'

const w = (start: number, end: number, text: string) => ({ start, end, text })

const audio: RawSeg[] = [
  { start: 1.2, end: 3.0, text: 'Hello how are you', words: [w(1.2, 1.6, ' Hello'), w(1.7, 2.0, ' how'), w(2.1, 2.4, ' are'), w(2.5, 3.0, ' you')] },
  { start: 4.1, end: 5.5, text: 'Where you go', words: [w(4.1, 4.6, ' Where'), w(4.7, 5.0, ' you'), w(5.1, 5.5, ' go')] },
  { start: 8.0, end: 9.0, text: 'Hmm okay', words: [w(8.0, 8.4, ' Hmm'), w(8.5, 9.0, ' okay')] }
]

describe('mergeListenRead', () => {
  it('uses screen words with speech timing, and keeps unsubtitled speech', () => {
    const screen: RawSeg[] = [
      { start: 1.0, end: 3.0, text: 'Hello, how are you?' },
      { start: 4.0, end: 6.0, text: 'Where are you going?' }
    ]
    const r = mergeListenRead(audio, screen, 0.5)
    expect(r.usedScreen).toBe(true)
    expect(r.lines.map((l) => l.original)).toEqual(['Hello, how are you?', 'Where are you going?', 'Hmm okay'])
    expect(r.lines[0].start).toBe(1.2) // snapped to the first spoken word, not the frame sample
    expect(r.lines[1].start).toBe(4.1)
    expect(r.lines[2]).toMatchObject({ start: 8, end: 9, source: 'audio' })
    for (let i = 1; i < r.lines.length; i++) expect(r.lines[i].start).toBeGreaterThanOrEqual(r.lines[i - 1].end)
  })

  it('falls back to audio when the video has no burned-in subtitles', () => {
    const r = mergeListenRead(audio, [{ start: 20, end: 21, text: 'CHANNEL LOGO' }], 0.5)
    expect(r.usedScreen).toBe(false)
    expect(r.lines.map((l) => l.original)).toEqual(['Hello how are you', 'Where you go', 'Hmm okay'])
  })

  it('puts Khmer on-screen subtitles into the translation column', () => {
    const screen: RawSeg[] = [
      { start: 1.0, end: 3.0, text: 'សួស្តី តើអ្នកសុខសប្បាយទេ?' },
      { start: 4.0, end: 6.0, text: 'តើអ្នកនឹងទៅណា?' },
      { start: 7.8, end: 9.0, text: 'អូខេ' }
    ]
    const r = mergeListenRead(audio, screen, 0.5)
    expect(r.screenIsTarget).toBe(true)
    expect(r.lines[0]).toMatchObject({ original: 'Hello how are you', target: 'សួស្តី តើអ្នកសុខសប្បាយទេ?' })
    expect(r.lines[1].target).toBe('តើអ្នកនឹងទៅណា?')
  })

  it('works when the transcription has no word timestamps', () => {
    const plain = audio.map(({ words: _w, ...s }) => s)
    const r = mergeListenRead(plain, [{ start: 1, end: 3.2, text: 'Hello, how are you?' }, { start: 4, end: 6, text: 'Where are you going?' }], 1)
    expect(r.lines[0]).toMatchObject({ start: 1.2, original: 'Hello, how are you?' })
  })

  it('detects Khmer script', () => {
    expect(isKhmer(['សួស្តី'])).toBe(true)
    expect(isKhmer(['Hello'])).toBe(false)
  })
})
