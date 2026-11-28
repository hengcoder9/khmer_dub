// Copyright check, listening part: is there music in the source, is it a known song / film score?
// Gemini listens to a few samples (the separated instrumental when there is one: cleaner music).
// Without a Gemini key: the instrumental's loudness says "music or not"; without either it says "not checked".

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { MusicFinding } from '../../shared/copyright'
import type { JobCtx } from '../queue'
import { runFfmpeg } from '../lib/ffmpeg'
import { keyPool } from '../lib/keys'
import { llmJson } from '../lib/llm'
import { ensureAudio } from './extract'

export interface CopyrightPayload {
  videoPath: string
  epDir: string
  durationSec: number
  instrumental?: string
  geminiModel: string
}

const SAMPLE = 20

/** Mean loudness (dB) of a file, or null. */
async function meanDb(path: string, ctx: JobCtx): Promise<number | null> {
  const r = await runFfmpeg(['-i', path, '-af', 'volumedetect', '-f', 'null', '-'], { signal: ctx.signal })
  const m = r.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)
  return m ? Number(m[1]) : null
}

export async function listenForMusic(p: CopyrightPayload, ctx: JobCtx): Promise<MusicFinding> {
  const inst = p.instrumental && existsSync(p.instrumental) ? p.instrumental : null
  if (!keyPool.has('gemini')) {
    if (!inst) return { hasMusic: false, kind: 'unknown', songs: [], by: 'none' }
    ctx.progress(30, 'Measuring the music track')
    const db = await meanDb(inst, ctx)
    return { hasMusic: db != null && db > -42, kind: 'unknown', songs: [], by: 'level' }
  }
  const src = inst ?? (await ensureAudio(p.videoPath, p.epDir, p.durationSec, ctx, [0, 20])).full
  const work = join(p.epDir, 'copyright_samples')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  try {
    const at = [0.12, 0.38, 0.62, 0.86].map((f) => Math.max(0, Math.min(p.durationSec - SAMPLE, p.durationSec * f)))
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []
    for (const [i, t] of at.entries()) {
      ctx.throwIfCanceled()
      ctx.progress(25 + i * 10, `Audio sample ${i + 1} of ${at.length}`)
      const f = join(work, `s${i}.mp3`)
      const r = await runFfmpeg(['-y', '-ss', t.toFixed(1), '-t', String(SAMPLE), '-i', src, '-vn', '-ac', '1', '-ar', '22050', '-b:a', '64k', f], { signal: ctx.signal })
      if (r.code === 0 && existsSync(f)) parts.push({ text: `Sample ${i + 1}:` }, { inlineData: { mimeType: 'audio/mp3', data: readFileSync(f).toString('base64') } })
    }
    if (!parts.length) return { hasMusic: false, kind: 'unknown', songs: [], by: 'none' }
    ctx.progress(70, 'Listening for songs and soundtracks')
    parts.push({
      text:
        (inst ? 'These samples are the background track of a video (voices removed). ' : 'These samples are from a video\'s audio. ') +
        'Is there music? Classify it: "song" (a released commercial song, with or without vocals), "score" (film / TV / drama soundtrack music), ' +
        '"stock" (generic production / royalty-free style music), or "none". If you recognise specific songs, name them (only when you are fairly sure). ' +
        'Return ONLY JSON: {"hasMusic": boolean, "kind": "song"|"score"|"stock"|"none", "songs": [{"title": string, "artist": string, "confidence": number}]}.'
    })
    const r = await llmJson<{ hasMusic?: boolean; kind?: string; songs?: Array<{ title?: string; artist?: string; confidence?: number }> }>({
      provider: 'gemini',
      model: p.geminiModel,
      parts,
      schema: {
        type: 'OBJECT',
        properties: {
          hasMusic: { type: 'BOOLEAN' },
          kind: { type: 'STRING', enum: ['song', 'score', 'stock', 'none'] },
          songs: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, artist: { type: 'STRING' }, confidence: { type: 'NUMBER' } }, required: ['title'] } }
        },
        required: ['hasMusic', 'kind']
      },
      temperature: 0,
      signal: ctx.signal
    })
    const kind = (['song', 'score', 'stock', 'none'] as const).find((k) => k === r.kind) ?? 'unknown'
    const songs = (r.songs ?? []).filter((s) => s.title?.trim() && (s.confidence ?? 1) >= 0.6).map((s) => ({ title: s.title!.trim(), artist: s.artist?.trim() || undefined }))
    ctx.progress(100, 'Done')
    return { hasMusic: !!r.hasMusic || songs.length > 0, kind: kind === 'none' && songs.length ? 'song' : kind, songs, by: 'ai' }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
