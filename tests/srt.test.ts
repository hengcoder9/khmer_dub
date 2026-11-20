import { describe, expect, it } from 'vitest'
import { formatTimestamp, parseSubtitles, serializeSrt, serializeVtt } from '../shared/srt'

describe('srt', () => {
  it('parses SRT with CRLF, BOM and multi-line text', () => {
    const src = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nសួស្តី\r\nពិភពលោក\r\n\r\n2\r\n00:00:03,250 --> 00:00:04,000\r\n<i>Hello</i>\r\n'
    expect(parseSubtitles(src)).toEqual([
      { start: 1, end: 2.5, text: 'សួស្តី\nពិភពលោក' },
      { start: 3.25, end: 4, text: 'Hello' }
    ])
  })

  it('parses VTT with header, short timestamps, cue ids and settings', () => {
    const src = 'WEBVTT\n\nNOTE comment\n\nintro\n00:01.500 --> 00:03.000 align:start\nHi <c.yellow>there</c>\n\n01:00:00.000 --> 01:00:01.000\nLate'
    expect(parseSubtitles(src)).toEqual([
      { start: 1.5, end: 3, text: 'Hi there' },
      { start: 3600, end: 3601, text: 'Late' }
    ])
  })

  it('skips broken cues and sorts by start', () => {
    const src = '1\n00:00:05,000 --> 00:00:06,000\nB\n\n2\nnot a time --> nope\nX\n\n3\n00:00:01,000 --> 00:00:02,000\nA'
    expect(parseSubtitles(src).map((c) => c.text)).toEqual(['A', 'B'])
  })

  it('round-trips SRT and VTT', () => {
    const cues = [
      { start: 0, end: 1.234, text: 'one' },
      { start: 3661.5, end: 3662, text: 'ពីរ' }
    ]
    expect(parseSubtitles(serializeSrt(cues))).toEqual([
      { start: 0, end: 1.23, text: 'one' },
      { start: 3661.5, end: 3662, text: 'ពីរ' }
    ])
    expect(serializeVtt(cues)).toContain('01:01:01.500 --> 01:01:02.000')
  })

  it('formats timestamps', () => {
    expect(formatTimestamp(0)).toBe('00:00:00,000')
    expect(formatTimestamp(83.456)).toBe('00:01:23,456')
    expect(formatTimestamp(-1)).toBe('00:00:00,000')
  })
})
