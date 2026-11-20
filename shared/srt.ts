// SRT / WebVTT parsing and serialization (pure, shared by backend + renderer).

export interface Cue {
  start: number
  end: number
  text: string
}

const TS = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/

function parseTs(s: string): number {
  const m = TS.exec(s)
  if (!m) return NaN
  const [, h, mm, ss, ms] = m
  return (Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms.padEnd(3, '0')) / 1000)
}

/** Parses SRT or WebVTT (auto-detected). Tolerates BOM, CRLF, missing indices, cue settings and tags. */
export function parseSubtitles(input: string): Cue[] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const blocks = text.split(/\n{2,}/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''))
    const tIdx = lines.findIndex((l) => l.includes('-->'))
    if (tIdx < 0) continue // WEBVTT header, NOTE, STYLE, or junk
    const [a, b] = lines[tIdx].split('-->')
    const start = parseTs(a)
    const end = parseTs(b)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const body = lines
      .slice(tIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '') // <i>, <c.x>, <00:01.000> karaoke tags
      .replace(/\{\\[^}]*\}/g, '') // stray ASS override tags
      .trim()
    cues.push({ start: round2(start), end: round2(Math.max(end, start)), text: body })
  }
  return cues.sort((x, y) => x.start - y.start)
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function formatTimestamp(sec: number, sep: ',' | '.' = ','): string {
  const totalMs = Math.max(0, Math.round(sec * 1000))
  const ms = totalMs % 1000
  const s = Math.floor(totalMs / 1000) % 60
  const m = Math.floor(totalMs / 60000) % 60
  const h = Math.floor(totalMs / 3600000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms, 3)}`
}

export function serializeSrt(cues: Cue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text.trim()}`)
      .join('\n\n') + '\n'
  )
}

export function serializeVtt(cues: Cue[]): string {
  return (
    'WEBVTT\n\n' +
    cues
      .map((c) => `${formatTimestamp(c.start, '.')} --> ${formatTimestamp(c.end, '.')}\n${c.text.trim()}`)
      .join('\n\n') +
    '\n'
  )
}
