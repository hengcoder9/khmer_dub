import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { atempoChain, computeFit, edgePitch, edgeRate } from '../../shared/fit'
import { runFfmpeg } from '../lib/ffmpeg'
import { readWavInfo } from '../lib/audio'
import { aiWorker, nextCloneLane, cloneLaneCount } from '../lib/python'
import { ffFail } from './extract'
import { getCloneVoice } from './voices'
import type { JobCtx } from '../queue'

export interface TtsItem {
  id: string
  text: string
  voiceId: string
  /** user base speed × global speed */
  speed: number
  pitch: number
  start: number
  end: number
  nextStart?: number
}

export interface TtsPayload {
  epDir: string
  items: TtsItem[]
  durationSec: number
  maxSpeed: number
  autoFit: boolean
  syncEnd: boolean
  dictionary: Array<{ from: string; to: string }>
  defaultMale: string
  defaultFemale: string
}

export interface TtsResult {
  id: string
  audioPath?: string
  audioDur?: number
  fitSpeed?: number
  fitWarning?: boolean
  error?: string
}

const TRIM =
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,areverse,' +
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse'

export function applyDictionary(text: string, dict: Array<{ from: string; to: string }>): string {
  let t = text
  for (const { from, to } of dict) {
    if (!from) continue
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // whole-word for Latin words, plain substring for Khmer (no spaces between words)
    const re = /^[\w\s'-]+$/.test(from) ? new RegExp(`\\b${esc}\\b`, 'gi') : new RegExp(esc, 'g')
    t = t.replace(re, to)
  }
  return t
}

async function pMap<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    })
  )
  return out
}

const hash = (...parts: unknown[]) => createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 20)

interface Gen {
  id: string
  engine: 'edge' | 'clone'
  voice: string // edge short name or clone id
  text: string
  speed: number
  pitch: number
  raw: string
  trimmed: string
}

function plan(item: TtsItem, p: TtsPayload, dir: string, speed: number): Gen {
  let voiceId = item.voiceId || 'default:male'
  if (voiceId === 'default:male') voiceId = p.defaultMale
  if (voiceId === 'default:female') voiceId = p.defaultFemale
  const [engine, voice] = voiceId.split(':', 2) as ['edge' | 'clone', string]
  const text = applyDictionary(item.text, p.dictionary)
  const s = Math.round(speed * 100) / 100
  const h = hash(engine, voice, text, s, item.pitch)
  return { id: item.id, engine, voice, text, speed: s, pitch: item.pitch, raw: join(dir, `${h}.${engine === 'edge' ? 'mp3' : 'wav'}`), trimmed: join(dir, `${h}.t.wav`) }
}

/** Generate missing raw files for a batch (edge in one worker job; clone across GPU lanes). */
async function generate(gens: Gen[], ctx: JobCtx, span: [number, number]): Promise<Map<string, string>> {
  const errors = new Map<string, string>()
  const todo = gens.filter((g) => !existsSync(g.raw))
  const edge = todo.filter((g) => g.engine === 'edge')
  const clone = todo.filter((g) => g.engine === 'clone')
  const [a, b] = span
  const mid = edge.length && clone.length ? (a + b) / 2 : b

  if (edge.length) {
    const r = await aiWorker.job<{ results: Array<{ id: string; ok: boolean; error?: string }> }>(
      'tts_edge',
      {
        items: edge.map((g) => ({ id: g.id, text: g.text, voice: g.voice, rate: edgeRate(g.speed), pitch: edgePitch(g.pitch), out: g.raw })),
        concurrency: 8
      },
      ctx,
      [a, mid]
    )
    for (const x of r.results) if (!x.ok) errors.set(x.id, x.error ?? 'Edge-TTS failed')
  }
  if (clone.length) {
    let done = 0
    await pMap(clone, cloneLaneCount(), async (g) => {
      ctx.throwIfCanceled()
      const v = getCloneVoice(g.voice)
      if (!v) {
        errors.set(g.id, `Clone voice not found: ${g.voice}`)
        return
      }
      try {
        await nextCloneLane().call('/tts', { text: g.text, ref_audio: v.refAudio, ref_text: v.refText, speed: g.speed, out: g.raw }, 900_000)
      } catch (e) {
        errors.set(g.id, (e as Error).message)
      }
      ctx.progress(mid + ((b - mid) * ++done) / clone.length, `Voice clone ${done}/${clone.length}`)
    })
  }
  return errors
}

async function trim(g: Gen, signal: AbortSignal): Promise<number> {
  if (!existsSync(g.trimmed)) {
    const r = await runFfmpeg(['-y', '-i', g.raw, '-af', TRIM, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', g.trimmed], { signal })
    if (r.code !== 0) throw ffFail('Trim', r.stderr)
  }
  return (await readWavInfo(g.trimmed)).duration
}

export async function tts(p: TtsPayload, ctx: JobCtx): Promise<{ results: TtsResult[] }> {
  const ttsDir = join(p.epDir, 'tts')
  const fitDir = join(p.epDir, 'fit')
  mkdirSync(ttsDir, { recursive: true })
  mkdirSync(fitDir, { recursive: true })
  const items = p.items.filter((i) => i.text.trim())
  const results = new Map<string, TtsResult>()
  for (const i of p.items) if (!i.text.trim()) results.set(i.id, { id: i.id, error: 'Empty text' })

  // pass 1: generate at the user's speed
  ctx.progress(0, `Generating ${items.length} lines`)
  const pass1 = items.map((i) => plan(i, p, ttsDir, i.speed))
  const err1 = await generate(pass1, ctx, [0, 55])
  ctx.throwIfCanceled()

  const durs = new Map<string, number>()
  await pMap(pass1, 4, async (g) => {
    if (err1.has(g.id)) return
    try {
      durs.set(g.id, await trim(g, ctx.signal))
    } catch (e) {
      err1.set(g.id, (e as Error).message)
    }
  })
  for (const [id, error] of err1) results.set(id, { id, error })

  // fit decisions
  const byId = new Map(items.map((i) => [i.id, i]))
  const fitOf = (id: string, dur: number) => {
    const i = byId.get(id)!
    return computeFit({ ttsDur: dur, start: i.start, end: i.end, nextStart: i.nextStart, mediaEnd: p.durationSec || undefined, syncEnd: p.syncEnd, maxSpeed: p.maxSpeed })
  }

  // pass 2: regenerate too-long lines with the engine's own rate (sounds better than atempo)
  const regen: Gen[] = []
  if (p.autoFit) {
    for (const g of pass1) {
      const d = durs.get(g.id)
      if (d === undefined) continue
      const f = fitOf(g.id, d)
      if (f.speed > 1.02) regen.push(plan(byId.get(g.id)!, p, ttsDir, g.speed * f.speed))
    }
  }
  const final = new Map(pass1.map((g) => [g.id, g]))
  if (regen.length) {
    ctx.progress(60, `Re-generating ${regen.length} fast lines`)
    const err2 = await generate(regen, ctx, [60, 85])
    await pMap(regen, 4, async (g) => {
      if (err2.has(g.id)) return // keep pass-1 audio and atempo it instead
      try {
        durs.set(g.id, await trim(g, ctx.signal))
        final.set(g.id, g)
      } catch {
        /* keep pass 1 */
      }
    })
  }

  // finalize: atempo whatever still overflows, write fit/<id>.wav
  ctx.progress(88, 'Fitting clips')
  let done = 0
  await pMap([...final.values()].filter((g) => durs.has(g.id)), 4, async (g) => {
    ctx.throwIfCanceled()
    const i = byId.get(g.id)!
    const out = join(fitDir, `${g.id}.wav`)
    const dur = durs.get(g.id)!
    const engineSpeedUp = g.speed / Math.max(0.01, i.speed)
    let fitSpeed = engineSpeedUp
    let warn = false
    if (p.autoFit) {
      const needed = dur / fitOf(g.id, dur).slot // uncapped (computeFit caps at maxSpeed)
      const maxExtra = p.maxSpeed / engineSpeedUp
      const extra = Math.min(Math.max(1, needed), maxExtra)
      warn = needed > maxExtra + 0.01
      if (extra > 1.01) {
        const r = await runFfmpeg(['-y', '-i', g.trimmed, '-af', atempoChain(extra), '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', out], { signal: ctx.signal })
        if (r.code !== 0) throw ffFail('atempo', r.stderr)
        fitSpeed = engineSpeedUp * extra
      } else copyFileSync(g.trimmed, out)
    } else {
      copyFileSync(g.trimmed, out)
      warn = dur > fitOf(g.id, dur).slot + 0.05
    }
    const audioDur = (await readWavInfo(out)).duration
    results.set(g.id, { id: g.id, audioPath: out, audioDur: Math.round(audioDur * 100) / 100, fitSpeed: Math.round(fitSpeed * 100) / 100, fitWarning: warn })
    ctx.progress(88 + (12 * ++done) / final.size)
  })

  return { results: p.items.map((i) => results.get(i.id) ?? { id: i.id, error: 'Not generated' }) }
}

/** One-off voice preview (cast panel / settings). */
export async function previewVoice(p: { voiceId: string; text: string; defaultMale: string; defaultFemale: string; outDir: string }): Promise<string> {
  const payload: TtsPayload = {
    epDir: p.outDir,
    items: [{ id: 'preview', text: p.text, voiceId: p.voiceId, speed: 1, pitch: 0, start: 0, end: 60 }],
    durationSec: 0,
    maxSpeed: 1,
    autoFit: false,
    syncEnd: false,
    dictionary: [],
    defaultMale: p.defaultMale,
    defaultFemale: p.defaultFemale
  }
  const g = plan(payload.items[0], payload, join(p.outDir, 'tts'), 1)
  mkdirSync(join(p.outDir, 'tts'), { recursive: true })
  const noop: JobCtx = { id: 'preview', signal: new AbortController().signal, progress() {}, log() {}, throwIfCanceled() {} }
  const errs = await generate([g], noop, [0, 100])
  if (errs.size) throw new Error([...errs.values()][0])
  return g.raw
}
