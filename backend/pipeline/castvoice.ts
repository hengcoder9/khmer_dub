// "Who is speaking?": for every actor, a short sample of their own lines is played to Gemini, which says
// man / woman and child / teen / adult / senior. Without a Gemini key (or when it fails) the voice pitch decides:
// a very high voice is a child. The result picks the matching voice (Boy, Girl, Teen, Grandpa, Grandma…).

import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AgeGroup, Gender } from '../../shared/types'
import type { JobCtx } from '../queue'
import { runFfmpeg } from '../lib/ffmpeg'
import { keyPool } from '../lib/keys'
import { llmJson } from '../lib/llm'
import { ensureAudio } from './extract'

export interface CastVoicePayload {
  videoPath: string
  epDir: string
  durationSec: number
  /** separated voices (cleaner) — falls back to the full audio */
  vocalsPath?: string
  actors: Array<{ id: string; gender: Gender; f0?: number; ranges: Array<{ start: number; end: number }> }>
  geminiModel: string
}

export interface CastVoiceResult {
  actors: Array<{ id: string; gender: Gender; age: AgeGroup; by: 'ai' | 'pitch' }>
}

const SAMPLE_SEC = 10
const AGES: AgeGroup[] = ['child', 'teen', 'adult', 'senior']

/** Pitch only: children speak around 250–400 Hz, women 165–255, men 85–155. */
export function ageFromPitch(f0?: number): AgeGroup {
  return f0 && f0 >= 255 ? 'child' : 'adult'
}

/** The longest lines first, until ~10 s (at least the 3 longest), back in time order. */
export function sampleRanges(ranges: Array<{ start: number; end: number }>, maxSec = SAMPLE_SEC): Array<{ start: number; end: number }> {
  const pick: Array<{ start: number; end: number }> = []
  let total = 0
  for (const r of [...ranges].filter((r) => r.end - r.start >= 0.6).sort((a, b) => b.end - b.start - (a.end - a.start))) {
    if (total >= maxSec && pick.length >= 3) break
    const len = Math.min(r.end - r.start, maxSec)
    pick.push({ start: r.start, end: r.start + len })
    total += len
  }
  return pick.sort((a, b) => a.start - b.start)
}

export async function detectCastVoices(p: CastVoicePayload, ctx: JobCtx): Promise<CastVoiceResult> {
  const pitchOnly = (): CastVoiceResult => ({ actors: p.actors.map((a) => ({ id: a.id, gender: a.gender, age: ageFromPitch(a.f0), by: 'pitch' })) })
  if (!p.actors.length) return { actors: [] }
  if (!keyPool.has('gemini')) {
    ctx.log('No Gemini key: ages from voice pitch only')
    return pitchOnly()
  }
  const { audio16k } = await ensureAudio(p.videoPath, p.epDir, p.durationSec, ctx, [0, 15])
  const src = p.vocalsPath || audio16k
  const work = join(p.epDir, 'cast_samples')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  try {
    // 1) one short sample per actor
    const clips: Array<{ id: string; file: string }> = []
    for (const [i, a] of p.actors.entries()) {
      ctx.throwIfCanceled()
      const rs = sampleRanges(a.ranges)
      if (!rs.length) continue
      ctx.progress(15 + (40 * i) / p.actors.length, `Voice sample ${i + 1} of ${p.actors.length}`)
      const graph = rs.map((r, k) => `[0:a]atrim=start=${r.start.toFixed(2)}:end=${r.end.toFixed(2)},asetpts=PTS-STARTPTS[s${k}]`).join(';') + `;${rs.map((_, k) => `[s${k}]`).join('')}concat=n=${rs.length}:v=0:a=1,aresample=16000[out]`
      const file = join(work, `a${i}.mp3`)
      const r = await runFfmpeg(['-y', '-i', src, '-filter_complex', graph, '-map', '[out]', '-ac', '1', '-b:a', '48k', file], { signal: ctx.signal })
      if (r.code === 0) clips.push({ id: a.id, file })
    }
    if (!clips.length) return pitchOnly()

    // 2) Gemini listens to all of them at once
    ctx.progress(60, `Listening to ${clips.length} voices`)
    const parts = clips.flatMap((c, i) => [{ text: `Clip ${i + 1}:` }, { inlineData: { mimeType: 'audio/mp3', data: readFileSync(c.file).toString('base64') } }])
    parts.push({
      text:
        'Each clip is one character speaking (a few of their lines from a film or drama). For every clip, judge the SPEAKER\'S VOICE: ' +
        'gender "male" or "female", and age group "child" (under 13 — a boy or a girl), "teen" (13–19), "adult" (20–59) or "senior" (60+, an old man / old woman). ' +
        'Ignore music and background sounds. confidence 0–1. Return ONLY JSON: [{"clip": number, "gender": "male"|"female", "age": "child"|"teen"|"adult"|"senior", "confidence": number}].'
    })
    let rows: Array<{ clip: number; gender: string; age: string; confidence?: number }> = []
    try {
      rows = await llmJson({
        provider: 'gemini',
        model: p.geminiModel,
        parts,
        schema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { clip: { type: 'NUMBER' }, gender: { type: 'STRING', enum: ['male', 'female'] }, age: { type: 'STRING', enum: AGES }, confidence: { type: 'NUMBER' } },
            required: ['clip', 'gender', 'age']
          }
        },
        temperature: 0,
        signal: ctx.signal
      })
    } catch (e) {
      ctx.log(`Gemini could not judge the voices (${(e as Error).message}) — using pitch`)
      return pitchOnly()
    }
    const byClip = new Map(rows.map((r) => [Number(r.clip), r]))
    ctx.progress(100, 'Voices judged')
    return {
      actors: p.actors.map((a) => {
        const i = clips.findIndex((c) => c.id === a.id)
        const r = i >= 0 ? byClip.get(i + 1) : undefined
        const sure = r && (r.confidence ?? 1) >= 0.4 && AGES.includes(r.age as AgeGroup)
        if (!sure) return { id: a.id, gender: a.gender, age: ageFromPitch(a.f0), by: 'pitch' as const }
        const gender: Gender = r.gender === 'male' || r.gender === 'female' ? r.gender : a.gender
        return { id: a.id, gender, age: r.age as AgeGroup, by: 'ai' as const }
      })
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
