import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { SttEngine } from '../../shared/types'
import { dedupeByTime, planChunks, postProcess, type RawSeg } from '../../shared/segments'
import { langName } from '../../shared/translate'
import { aiWorker } from '../lib/python'
import { llmJson } from '../lib/llm'
import { runFfmpeg } from '../lib/ffmpeg'
import { detectSilences, ensureAudio, ffFail } from './extract'
import { keyPool } from '../lib/keys'
import { llmParallelism, mapLimit } from '../../shared/parallel'
import type { JobCtx } from '../queue'

export interface TranscribePayload {
  engine: SttEngine
  videoPath: string
  epDir: string
  durationSec: number
  sourceLang: string // 'auto' or code
  targetLang: string
  glossary: { source: string; target: string }[]
  geminiModel: string
  whisperModel: string
  /** use vocals.wav when available (cleaner for STT) */
  vocalsPath?: string
}

export interface TranscribeResult {
  language?: string
  segments: RawSeg[]
}

export async function transcribe(p: TranscribePayload, ctx: JobCtx): Promise<TranscribeResult> {
  const { audio16k } = await ensureAudio(p.videoPath, p.epDir, p.durationSec, ctx, [0, 8])
  ctx.throwIfCanceled()
  if (p.engine === 'whisper' || p.engine === 'offline') return whisper(p, audio16k, ctx)
  return gemini(p, audio16k, ctx, p.engine === 'gemini-direct')
}

async function whisper(p: TranscribePayload, audio16k: string, ctx: JobCtx): Promise<TranscribeResult> {
  ctx.progress(8, `Loading Whisper ${p.whisperModel}`)
  const r = await aiWorker.job<{ language: string; segments: RawSeg[] }>(
    'stt',
    { audio: audio16k, model: p.whisperModel, language: p.sourceLang === 'auto' ? null : p.sourceLang },
    ctx,
    [8, 100]
  )
  return { language: r.language, segments: postProcess(r.segments) }
}

const SPEAKER_RULES =
  'Identify distinct speakers and label them A1, A2, A3… consistently (same voice = same label). ' +
  'Estimate each speaker gender as "male", "female" or "unknown".'

function schema(withTranslation: boolean) {
  const props: Record<string, unknown> = {
    start: { type: 'NUMBER' },
    end: { type: 'NUMBER' },
    speaker: { type: 'STRING' },
    gender: { type: 'STRING', enum: ['male', 'female', 'unknown'] },
    original: { type: 'STRING' }
  }
  if (withTranslation) props.khmer = { type: 'STRING' }
  return {
    type: 'ARRAY',
    items: { type: 'OBJECT', properties: props, required: Object.keys(props), propertyOrdering: Object.keys(props) }
  }
}

async function gemini(p: TranscribePayload, audio16k: string, ctx: JobCtx, translate: boolean): Promise<TranscribeResult> {
  ctx.progress(8, 'Finding chunk boundaries')
  const silences = p.durationSec > 600 ? await detectSilences(audio16k, { minDur: 0.4, durationSec: p.durationSec, signal: ctx.signal }) : []
  const chunks = planChunks(p.durationSec, silences)
  const tmp = join(p.epDir, 'tmp_chunks')
  mkdirSync(tmp, { recursive: true })
  const lang = langName(p.targetLang)
  const glossary = p.glossary.length ? p.glossary.map((g) => `${g.source} = ${g.target}`).join('\n') : '(none)'
  const all: RawSeg[] = []
  const speakerNotes = new Map<string, string>()

  let done = 0
  const report = () => ctx.progress(10 + (88 * done) / chunks.length, `Gemini: ${done}/${chunks.length} chunks done`)
  const runChunk = async (i: number) => {
      ctx.throwIfCanceled()
      const c = chunks[i]
      const mp3 = join(tmp, `c${i}.mp3`)
      const enc = await runFfmpeg(
        ['-y', '-ss', String(c.start), '-t', String(c.end - c.start), '-i', audio16k, '-ac', '1', '-ar', '16000', '-b:a', '32k', mp3],
        { signal: ctx.signal }
      )
      if (enc.code !== 0) throw ffFail('Audio chunk encoding', enc.stderr)
      const data = readFileSync(mp3).toString('base64')
      const known = [...speakerNotes.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')

      const instructions = [
        'Transcribe ALL speech in this audio clip exactly as spoken (original language).',
        'Timestamps are seconds from the start of THIS clip, accurate to 0.1 s. Split into natural subtitle lines of at most ~8 seconds.',
        SPEAKER_RULES,
        known ? `Speakers already identified earlier in this video (reuse these labels when it is the same voice):\n${known}` : '',
        translate
          ? `Also translate each line into natural spoken ${lang} for dubbing, short enough to say in the same time, in the "khmer" field. Keep names consistent with the glossary.\nGlossary:\n${glossary}`
          : '',
        p.sourceLang !== 'auto' ? `The spoken language is ${langName(p.sourceLang)}.` : '',
        'Skip music-only and silent parts. Return ONLY the JSON array.'
      ]
        .filter(Boolean)
        .join('\n')

      type Row = { start: number; end: number; speaker: string; gender: string; original: string; khmer?: string }
      const rows = await llmJson<Row[]>({
        provider: 'gemini',
        model: p.geminiModel,
        parts: [{ inlineData: { mimeType: 'audio/mp3', data } }, { text: instructions }],
        schema: schema(translate),
        temperature: 0.2,
        signal: ctx.signal
      })
      if (!Array.isArray(rows)) throw new Error('Gemini returned an unexpected format')
      for (const r of rows) {
        const start = Number(r.start) + c.start
        const end = Number(r.end) + c.start
        if (!Number.isFinite(start) || !Number.isFinite(end) || !r.original?.trim()) continue
        const speaker = /^A\d+$/i.test(r.speaker ?? '') ? r.speaker.toUpperCase() : r.speaker || 'A1'
        if (!speakerNotes.has(speaker)) speakerNotes.set(speaker, `${r.gender}, said "${r.original.slice(0, 60)}"`)
        all.push({
          start,
          end: Math.min(Math.max(end, start + 0.3), p.durationSec || end),
          text: r.original.trim(),
          speaker,
          gender: r.gender,
          translated: r.khmer?.trim()
        })
      }
      done++
      report()
  }

  try {
    report()
    // chunk 1 first so its speaker labels guide the rest; then the remaining chunks in parallel
    await runChunk(0)
    await mapLimit(chunks.slice(1).map((_, k) => k + 1), llmParallelism(keyPool.all('gemini').length), runChunk)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  all.sort((x, y) => x.start - y.start)
  return { segments: postProcessKeepTranslation(dedupeByTime(all)) }
}

/** postProcess drops translations on split segments; Gemini lines are already well-sized, so only clamp + merge. */
function postProcessKeepTranslation(segs: RawSeg[]): RawSeg[] {
  const hasT = segs.some((s) => s.translated)
  if (!hasT) return postProcess(segs)
  return postProcess(segs).map((s) => {
    if (s.translated) return s
    const src = segs.find((o) => Math.abs(o.start - s.start) < 0.05 && o.translated)
    return src ? { ...s, translated: src.translated } : s
  })
}
