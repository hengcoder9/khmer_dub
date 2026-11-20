// Renderer-side orchestration: build job payloads from project state, apply results back (undoable).

import { toast } from 'sonner'
import type { Actor, Episode, MediaInfo, Segment, SttEngine, Translator, Voice } from '@shared/types'
import type { RawSeg } from '@shared/segments'
import type { TResult } from '@shared/translate'
import { actorStats, autoMatchVoices, matchSpeakers } from '@shared/cast'
import { newSegment, uid } from '@shared/defaults'
import { effectiveClips, mapCuesToOutput, totalDuration } from '@shared/ranges'
import { mergeListenRead } from '@shared/screenmerge'
import type { Cue } from '@shared/srt'
import { api, post } from './api'
import { runJob } from '@/store/jobs'
import {
  activeEpisode,
  epDir,
  mutate,
  patchSegments,
  setEpisodeVideo,
  sortSegments,
  updateEpisode,
  updateSegments,
  useProject
} from '@/store/project'
import { llmChoice, useSettings } from '@/store/settings'

const S = () => useSettings.getState()
const P = () => useProject.getState()

export const VIDEO_FILTERS = [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'm4v', 'webm', 'avi'] }]
export const AUDIO_FILTERS = [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg'] }]
export const SUB_FILTERS = [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }]

function ep(id?: string): Episode {
  const e = id ? P().project?.episodes.find((x) => x.id === id) : activeEpisode()
  if (!e) throw new Error('No episode')
  return e
}

function needVideo(e: Episode) {
  if (!e.videoPath) throw new Error('Import a video for this episode first')
}

export const notify = (e: unknown) => {
  const msg = (e as Error).message
  if (msg !== 'Canceled') toast.error(msg)
}

// ───────── import ─────────

export async function importVideo(epId?: string, path?: string) {
  const e = ep(epId)
  const p = path ?? (await window.api.openFile({ filters: VIDEO_FILTERS }))
  if (!p) return
  const info = await post<MediaInfo>('/media/probe', { path: p })
  if (e.segments.length && e.videoPath && !confirm('Replace the video of this episode? Lines are kept.')) return
  setEpisodeVideo(e.id, info)
  info.warnings.forEach((w) => toast.warning(w))
  return info
}

export async function importSubtitles(epId?: string) {
  const e = ep(epId)
  const p = await window.api.openFile({ filters: SUB_FILTERS })
  if (!p) return
  const { cues } = await post<{ cues: Cue[] }>('/subs/import', { path: p })
  const asTarget = confirm(`Loaded ${cues.length} lines.\n\nOK = these are ${S().lang === 'km' ? 'Khmer' : 'target-language'} (translated) lines\nCancel = these are ORIGINAL-language lines`)
  const segs = cues.map((c) => newSegment(c.start, c.end, asTarget ? '' : c.text, asTarget ? c.text : ''))
  updateEpisode(e.id, (x) => ({ ...x, segments: sortSegments(segs), status: asTarget ? 'translated' : 'transcribed' }))
  toast.success(`Imported ${segs.length} lines`)
}

export function episodeCues(e: Episode, source: 'target' | 'original' = 'target'): Cue[] {
  return sortSegments(e.segments)
    .map((s) => ({ start: s.start, end: s.end, text: (source === 'target' ? s.textTarget || s.textOriginal : s.textOriginal || s.textTarget).trim() }))
    .filter((c) => c.text)
}

export async function exportSubtitles(format: 'srt' | 'vtt', epId?: string) {
  const e = ep(epId)
  const name = `${P().project?.name ?? 'subtitles'}_${e.label}.${format}`
  const p = await window.api.saveFile({ defaultPath: name, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
  if (!p) return
  // with "Apply edits on export" on, the exported video is cut/reordered, so subtitle times must follow the edited timeline
  const cues = e.edit.enabled ? mapCuesToOutput(episodeCues(e), effectiveClips(e.edit)) : episodeCues(e)
  await post('/subs/export', { path: p, cues, format })
  toast.success(`Saved ${p}`)
}

export async function importBgm(epId?: string) {
  const e = ep(epId)
  const p = await window.api.openFile({ filters: AUDIO_FILTERS })
  if (!p) return
  await post('/media/allow', { path: p })
  updateEpisode(e.id, (x) => ({ ...x, edit: { ...x.edit, bgm: { path: p, volume: 0.25, loop: true } } }))
  toast.success('Background music added (mixed under the dub)')
}

export async function importVoiceTrack(epId?: string) {
  const e = ep(epId)
  const p = await window.api.openFile({ filters: AUDIO_FILTERS })
  if (!p) return
  await post('/media/allow', { path: p })
  updateEpisode(e.id, (x) => ({ ...x, voiceTrack: p }))
  toast.success('AI voice track imported — it replaces generated lines in the mix')
}

// ───────── separation ─────────

export async function separateVocals(epId?: string) {
  const e = ep(epId)
  needVideo(e)
  const r = await runJob<{ full: string; audio16k: string; vocals: string; instrumental: string }>(
    'separate',
    { videoPath: e.videoPath, epDir: epDir(e), durationSec: e.durationSec },
    e.id
  )
  updateEpisode(e.id, (x) => ({ ...x, stems: { ...x.stems, ...r }, status: x.status === 'new' ? 'separated' : x.status }), { undo: false })
  toast.success('Vocals separated — instrumental is on track A2')
  return r
}

// ───────── transcription ─────────

function applyCastFromSpeakers(epId: string, speakers: Array<{ id: string; gender: Actor['gender']; embedding?: number[] }>, assign: Record<string, string>) {
  mutate((p) => {
    const { mapping, cast } = matchSpeakers(speakers, p.cast)
    const episodes = p.episodes.map((e) =>
      e.id !== epId ? e : { ...e, segments: e.segments.map((s) => (assign[s.id] ? { ...s, actorId: mapping[assign[s.id]] } : s)) }
    )
    const all = episodes.flatMap((e) => e.segments)
    return { ...p, episodes, cast: actorStats(cast, all) }
  })
}

function transcribeJob(e: Episode, engine: SttEngine) {
  const p = P().project!
  return runJob<{ language?: string; segments: RawSeg[] }>(
    'transcribe',
    {
      engine,
      videoPath: e.videoPath,
      epDir: epDir(e),
      durationSec: e.durationSec,
      sourceLang: p.settings.sourceLang,
      targetLang: p.settings.targetLang,
      glossary: p.glossary,
      geminiModel: S().geminiModel,
      whisperModel: p.settings.whisperModel,
      vocalsPath: e.stems.vocals
    },
    e.id
  )
}

export async function transcribe(engine: SttEngine, epId?: string, opts: { chain?: boolean; ask?: boolean } = {}) {
  const { chain = true, ask = true } = opts
  const e = ep(epId)
  needVideo(e)
  const p = P().project!
  if (ask && e.segments.length && !confirm(`Replace the ${e.segments.length} existing lines with a new transcription?`)) return
  const r = await transcribeJob(e, engine)
  const segs: Segment[] = r.segments.map((s) => ({ ...newSegment(s.start, s.end, s.text, s.translated ?? ''), words: s.words }))
  const speakerOf: Record<string, string> = {}
  r.segments.forEach((s, i) => s.speaker && (speakerOf[segs[i].id] = s.speaker))
  updateEpisode(e.id, (x) => ({ ...x, segments: segs, status: engine === 'gemini-direct' ? 'translated' : 'transcribed' }))
  if (r.language && p.settings.sourceLang === 'auto') mutate((pp) => ({ ...pp, settings: { ...pp.settings, sourceLang: r.language! } }), { undo: false })
  toast.success(`Transcribed ${segs.length} lines`)

  // Gemini returns speakers + gender directly
  const speakerIds = [...new Set(Object.values(speakerOf))]
  if (speakerIds.length) {
    const genders = new Map(r.segments.filter((s) => s.speaker).map((s) => [s.speaker!, (s.gender as Actor['gender']) ?? 'unknown']))
    applyCastFromSpeakers(e.id, speakerIds.map((id) => ({ id, gender: genders.get(id) ?? 'unknown' })), speakerOf)
  }
  // chains
  if (!chain) return
  if (engine === 'offline') {
    await diarize(e.id).catch(notify)
    await translate(e.id, undefined, 'offline')
  } else if (engine === 'whisper' || engine === 'gemini-cast') {
    await translate(e.id)
  }
}

export async function diarize(epId?: string) {
  const e = ep(epId)
  needVideo(e)
  if (!e.segments.length) throw new Error('Transcribe first')
  const r = await runJob<{ assign: Record<string, string>; speakers: Array<{ id: string; gender: Actor['gender']; embedding: number[] }> }>(
    'diarize',
    {
      videoPath: e.videoPath,
      epDir: epDir(e),
      durationSec: e.durationSec,
      segments: e.segments.map((s) => ({ id: s.id, start: s.start, end: s.end })),
      vocalsPath: e.stems.vocals
    },
    e.id
  )
  applyCastFromSpeakers(e.id, r.speakers, r.assign)
  toast.success(`Found ${r.speakers.length} speakers`)
}

// ───────── translation ─────────

export async function translate(epId?: string, ids?: string[], provider?: Translator) {
  const e = ep(epId)
  const p = P().project!
  const want = ids ? new Set(ids) : null
  const segs = sortSegments(e.segments).filter((s) => (want ? want.has(s.id) : !s.textTarget.trim()) && s.textOriginal.trim())
  if (!segs.length) {
    toast.info('Nothing to translate')
    return
  }
  const first = segs[0]
  const before = sortSegments(e.segments).filter((s) => s.end <= first.start && s.textTarget).slice(-10)
  const r = await runJob<{ results: TResult[]; suggestions: string[] }>(
    'translate',
    {
      items: segs.map((s) => ({ id: s.id, text: s.textOriginal })),
      provider: provider ?? p.settings.translator,
      targetLang: p.settings.targetLang,
      sourceLang: p.settings.sourceLang,
      glossary: p.glossary,
      context: before.map((s) => ({ id: s.id, khmer: s.textTarget })),
      geminiModel: S().geminiModel,
      openrouterModel: S().openrouterModel,
      claudeModel: S().claudeModel
    },
    e.id
  )
  const map = new Map(r.results.map((x) => [x.id, x.khmer]))
  updateEpisode(e.id, (x) => ({
    ...x,
    status: x.status === 'new' || x.status === 'transcribed' || x.status === 'separated' ? 'translated' : x.status,
    segments: x.segments.map((s) => (map.has(s.id) ? { ...s, textTarget: map.get(s.id)!, audioPath: undefined, fitWarning: undefined } : s))
  }))
  const fresh = r.suggestions.filter((w) => !P().project!.glossary.some((g) => g.source.toLowerCase() === w.toLowerCase()))
  if (fresh.length) {
    toast.info(`Glossary suggestions: ${fresh.slice(0, 8).join(', ')}`, {
      duration: 12000,
      action: {
        label: 'Add',
        onClick: () => mutate((pp) => ({ ...pp, glossary: [...pp.glossary, ...fresh.map((s) => ({ source: s, target: '' }))] }))
      }
    })
  }
  toast.success(`Translated ${r.results.length} lines`)
}

export async function shortenSegment(segId: string, epId?: string) {
  const e = ep(epId)
  const s = e.segments.find((x) => x.id === segId)
  if (!s) return
  const ratio = s.fitSpeed && s.fitSpeed > 1 ? s.fitSpeed : P().project!.settings.maxSpeed + 0.2
  const p = P().project!
  const { provider, model } = llmChoice(p.settings.translator)
  const r = await post<{ text: string }>('/ai/shorten', {
    text: s.textTarget,
    original: s.textOriginal,
    targetLang: p.settings.targetLang,
    ratio,
    provider,
    model
  })
  patchSegments(e.id, [segId], { textTarget: r.text, audioPath: undefined, fitWarning: undefined })
  return r.text
}

// ───────── voices / TTS ─────────

let voiceCache: Voice[] | null = null
export async function loadVoices(refresh = false): Promise<Voice[]> {
  if (voiceCache && !refresh) return voiceCache
  voiceCache = await api<Voice[]>(`/voices${refresh ? '?refresh=1' : ''}`)
  return voiceCache
}

export function voiceFor(s: Segment, cast: Actor[]): string {
  if (s.voiceId) return s.voiceId
  const a = cast.find((x) => x.id === s.actorId)
  if (a?.voiceId) return a.voiceId
  return a?.gender === 'female' ? 'default:female' : 'default:male'
}

export async function generateVoices(ids?: string[], epId?: string) {
  const e = ep(epId)
  const p = P().project!
  const st = p.settings
  const sorted = sortSegments(e.segments)
  const want = ids?.length ? new Set(ids) : null
  const targets = sorted.filter((s) => (!want || want.has(s.id)) && s.textTarget.trim())
  if (!targets.length) throw new Error('No translated lines to voice')
  const r = await runJob<{ results: Array<{ id: string; audioPath?: string; audioDur?: number; fitSpeed?: number; fitWarning?: boolean; error?: string }> }>(
    'tts',
    {
      epDir: epDir(e),
      durationSec: e.durationSec,
      maxSpeed: st.maxSpeed,
      autoFit: st.autoFit,
      syncEnd: st.syncEnd,
      dictionary: S().dictionary,
      defaultMale: S().defaultMale,
      defaultFemale: S().defaultFemale,
      items: targets.map((s) => {
        const next = sorted[sorted.indexOf(s) + 1]
        return {
          id: s.id,
          text: s.textTarget,
          voiceId: voiceFor(s, p.cast),
          speed: Math.max(0.5, s.speed * st.globalSpeed),
          pitch: s.pitch + st.globalPitch,
          start: s.start,
          end: s.end,
          nextStart: next?.start
        }
      })
    },
    e.id
  )
  const byId = new Map(r.results.map((x) => [x.id, x]))
  updateEpisode(
    e.id,
    (x) => ({
      ...x,
      status: 'voiced',
      segments: x.segments.map((s) => {
        const res = byId.get(s.id)
        if (!res || res.error) return s
        return { ...s, audioPath: res.audioPath, audioDur: res.audioDur, fitSpeed: res.fitSpeed, fitWarning: res.fitWarning }
      })
    }),
    { undo: false }
  )
  const errs = r.results.filter((x) => x.error)
  if (errs.length) toast.error(`${errs.length} line(s) failed: ${errs[0].error}`)
  const warn = r.results.filter((x) => x.fitWarning).length
  toast.success(`Voiced ${r.results.length - errs.length} lines${warn ? ` — ${warn} too fast ▲` : ''}`)
}

// ───────── mix / export ─────────

export async function mixEpisode(epId?: string) {
  const e = ep(epId)
  needVideo(e)
  const st = P().project!.settings
  const clips = e.segments.filter((s) => s.audioPath).map((s) => ({ path: s.audioPath!, start: s.start, gain: s.volume * st.globalVolume }))
  if (!clips.length && !e.voiceTrack) throw new Error('Generate voices first')
  const r = await runJob<{ dub: string; mix: string }>(
    'mix',
    {
      videoPath: e.videoPath,
      epDir: epDir(e),
      durationSec: e.durationSec,
      clips,
      voiceTrack: e.voiceTrack,
      instrumental: e.stems.instrumental,
      bgm: e.edit.bgm,
      ducking: st.ducking,
      duckLevelDb: st.duckLevelDb,
      keepOriginal: st.keepOriginal,
      origVolume: st.origVolume,
      muteOriginal: st.muteOriginal,
      reverb: st.reverb
    },
    e.id
  )
  updateEpisode(e.id, (x) => ({ ...x, stems: { ...x.stems, dub: r.dub, mix: r.mix }, status: 'mixed' }), { undo: false })
  return r
}

export interface ExportOptions {
  outDir: string
  mp4: boolean
  srt: boolean
  vtt: boolean
  ass: boolean
  dubWav: boolean
  instrumental: boolean
  burn: boolean
  applyEdit: boolean
  remix: boolean
  originalAudio: boolean
  cpu: boolean
}

export async function exportEpisode(opts: ExportOptions, epId?: string) {
  let e = ep(epId)
  needVideo(e)
  const p = P().project!
  let mixPath: string | undefined
  if (opts.mp4 && !opts.originalAudio && (e.segments.some((s) => s.audioPath) || e.voiceTrack)) {
    if (opts.remix || !e.stems.mix) await mixEpisode(e.id)
    e = ep(e.id)
    mixPath = e.stems.mix
  }
  const clips = effectiveClips(e.edit)
  const editOn = opts.applyEdit && e.edit.enabled
  const r = await runJob<{ files: string[] }>(
    'export',
    {
      videoPath: e.videoPath,
      epDir: epDir(e),
      durationSec: e.durationSec,
      width: e.media?.video?.width ?? 1280,
      height: e.media?.video?.height ?? 720,
      mixPath,
      outDir: opts.outDir,
      // keep names short: long downloaded titles pushed paths past Windows' 260-char limit (Explorer/players can't open them)
      baseName: `${p.name.trim().slice(0, 60).trim()}_${e.label}`
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .trim()
        .replace(/[. ]+$/, '') || 'export',
      cues: episodeCues(e, p.settings.captions.source),
      captions: p.settings.captions,
      captionLang: p.settings.captions.source === 'target' ? p.settings.targetLang : p.settings.sourceLang || 'en',
      burn: opts.burn,
      edit: editOn ? { clips, aspect: e.edit.aspect, fitMode: e.edit.fitMode, fadeIn: e.edit.fadeIn, fadeOut: e.edit.fadeOut } : undefined,
      outputs: {
        mp4: opts.mp4,
        srt: opts.srt,
        vtt: opts.vtt,
        ass: opts.ass,
        dubWav: opts.dubWav ? e.stems.dub : undefined,
        instrumental: opts.instrumental ? e.stems.instrumental : undefined
      },
      encoder: opts.cpu ? 'cpu' : 'auto'
    },
    e.id
  )
  updateEpisode(e.id, (x) => ({ ...x, status: 'exported', exports: r.files }), { undo: false })
  return r.files
}

export const editedDuration = (e: Episode) => (e.edit.enabled ? totalDuration(effectiveClips(e.edit)) : e.durationSec)

// ───────── read screen (OCR) ─────────

const ocrJob = (e: Episode) =>
  runJob<{ segments: RawSeg[] }>(
    'ocr',
    { videoPath: e.videoPath, epDir: epDir(e), durationSec: e.durationSec, interval: S().ocrInterval, cropTop: S().ocrCropTop, geminiModel: S().geminiModel },
    e.id
  )

export async function readScreen(epId?: string) {
  const e = ep(epId)
  needVideo(e)
  if (e.segments.length && !confirm(`Replace the ${e.segments.length} existing lines with subtitles read from the screen?`)) return
  const r = await ocrJob(e)
  updateEpisode(e.id, (x) => ({ ...x, segments: r.segments.map((s) => newSegment(s.start, s.end, s.text, '')), status: 'transcribed' }))
  toast.success(`Read ${r.segments.length} subtitle lines from the screen`)
}

// ───────── Listen + Read → SRT ─────────

const safeName = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/[. ]+$/, '') || 'subtitles'

/**
 * Listen to the speech (Whisper: precise timing) and read the burned-in subtitles (Gemini vision: exact words)
 * at the same time, merge them, translate to the target language and save original + translated SRT files.
 */
export async function listenReadSrt(epId?: string) {
  const e = ep(epId)
  needVideo(e)
  const p = P().project!
  if (e.segments.length && !confirm(`Replace the ${e.segments.length} existing lines with a new Listen + Read result?`)) return
  const outDir = await window.api.openDir({ title: 'Save the SRT files to…' })
  if (!outDir) return

  const listen = async () => {
    try {
      return await transcribeJob(e, 'whisper')
    } catch (err) {
      const alt = p.settings.sttEngine === 'whisper' || p.settings.sttEngine === 'offline' ? 'gemini-cast' : p.settings.sttEngine
      toast.warning(`Whisper unavailable (${(err as Error).message}) — listening with Gemini instead`)
      return transcribeJob(e, alt)
    }
  }
  const read = ocrJob(e).catch((err) => {
    if ((err as Error).message !== 'Canceled') toast.warning(`Couldn't read the screen (${(err as Error).message}) — using speech only`)
    return { segments: [] as RawSeg[] }
  })
  const [heard, seen] = await Promise.all([listen(), read])

  const m = mergeListenRead(heard.segments, seen.segments, S().ocrInterval)
  if (!m.lines.length) throw new Error('No speech or subtitles found in this video')
  const segs = m.lines.map((l) => newSegment(l.start, l.end, l.original, l.target))
  updateEpisode(e.id, (x) => ({ ...x, segments: segs, status: m.screenIsTarget ? 'translated' : 'transcribed' }))
  if (heard.language && p.settings.sourceLang === 'auto') mutate((pp) => ({ ...pp, settings: { ...pp.settings, sourceLang: heard.language! } }), { undo: false })
  toast.success(
    m.usedScreen
      ? `Listen + Read: ${segs.length} lines (${Math.round(m.coverage * 100)}% of speech had on-screen subtitles)`
      : `No burned-in subtitles found — ${segs.length} lines from speech`
  )

  // translate what isn't translated yet; still save the original SRT if translation fails
  let trErr: unknown
  if (segs.some((s) => !s.textTarget.trim())) await translate(e.id).catch((err) => (trErr = err))

  const done = ep(e.id)
  const map = (cues: Cue[]) => (done.edit.enabled ? mapCuesToOutput(cues, effectiveClips(done.edit)) : cues)
  const base = safeName(`${p.name.trim().slice(0, 60).trim()}_${done.label}`)
  const src = P().project!.settings.sourceLang
  const tgt = P().project!.settings.targetLang
  const files: string[] = []
  const save = async (name: string, cues: Cue[]) => {
    if (!cues.length) return
    const path = `${outDir}\\${name}`
    await post('/subs/export', { path, cues: map(cues), format: 'srt' })
    files.push(path)
  }
  const orig = sortSegments(done.segments).map((s) => ({ start: s.start, end: s.end, text: s.textOriginal.trim() })).filter((c) => c.text)
  const trans = sortSegments(done.segments).map((s) => ({ start: s.start, end: s.end, text: s.textTarget.trim() })).filter((c) => c.text)
  await save(`${base}_${src && src !== 'auto' ? src : 'original'}.srt`, orig)
  await save(`${base}_${tgt}.srt`, trans)
  if (trErr) notify(trErr)
  if (files.length) {
    toast.success(`Saved ${files.length} SRT file${files.length > 1 ? 's' : ''}`, {
      duration: 10000,
      action: { label: 'Show', onClick: () => window.api.showInFolder(files[files.length - 1]) }
    })
  }
  return files
}

// ───────── cast ─────────

export async function autoMatchCast() {
  const voices = await loadVoices()
  const lang = P().project!.settings.targetLang
  mutate((p) => ({ ...p, cast: autoMatchVoices(p.cast, voices.filter((v) => !v.id.startsWith('default:')), lang) }))
}

export function refreshCastStats() {
  mutate((p) => ({ ...p, cast: actorStats(p.cast, p.episodes.flatMap((e) => e.segments)) }), { undo: false })
}

export function addActor(gender: Actor['gender'] = 'unknown') {
  mutate((p) => {
    const n = p.cast.reduce((m, a) => Math.max(m, Number(a.id.replace(/\D/g, '')) || 0), 0) + 1
    return { ...p, cast: [...p.cast, { id: `A${n}`, label: `A${n}`, gender, lines: 0, totalSec: 0, sampleText: '' }] }
  })
}

// ───────── editor ─────────

export async function detectSilences(epId?: string) {
  const e = ep(epId)
  needVideo(e)
  const src = e.stems.vocals ?? e.stems.audio16k
  const path = src ?? (await runJob<{ audio16k: string }>('extract', { videoPath: e.videoPath, epDir: epDir(e), durationSec: e.durationSec }, e.id)).audio16k
  const r = await runJob<{ silences: Array<{ start: number; end: number }> }>(
    'silences',
    { path, durationSec: e.durationSec, noiseDb: S().silenceDb, minDur: S().silenceMin },
    e.id
  )
  return r.silences
}

export const newClipId = () => uid('c')

// ───────── log ─────────
export const appendLog = (name: string, lines: string[]) => post('/logs/append', { name, lines }).catch(() => {})
