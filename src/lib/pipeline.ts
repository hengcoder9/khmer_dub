// Renderer-side orchestration: build job payloads from project state, apply results back (undoable).

import { toast } from 'sonner'
import type { Actor, Episode, MediaInfo, Segment, SttEngine, Translator, Voice } from '@shared/types'
import type { RawSeg } from '@shared/segments'
import type { TResult } from '@shared/translate'
import { actorStats, autoMatchVoices, matchSpeakers, tidyCast } from '@shared/cast'
import { episodeLabel, newEpisode, newSegment, uid } from '@shared/defaults'
import { dubSpans, effectiveClips, mapCuesToOutput, outputDuration } from '@shared/ranges'
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
/** Source language to send: "same as the target" makes no sense for dubbing (it made Whisper hear Chinese as Khmer), so treat it as auto. */
const srcLang = (st: { sourceLang: string; targetLang: string }) => (st.sourceLang === st.targetLang ? 'auto' : st.sourceLang)
/** Remember a detected language only while set to auto, and never the target language itself. */
const keepDetected = (lang?: string) => {
  const st = P().project?.settings
  if (lang && st && srcLang(st) === 'auto' && lang !== st.targetLang) mutate((pp) => ({ ...pp, settings: { ...pp.settings, sourceLang: lang } }), { undo: false })
}
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
  const oldLines = e.videoPath && e.videoPath !== p ? e.segments.length : 0
  if (oldLines && !confirm('Replace the video of this episode?')) return
  setEpisodeVideo(e.id, info)
  info.warnings.forEach((w) => toast.warning(w))
  // the old lines belong to the old video: offer to make lines for this one right away
  if (oldLines && confirm(`This episode has ${oldLines} lines from the previous video. Make new lines for this video now?

OK = new lines (Listen + Read, then translate)
Cancel = keep the old lines`)) {
    void remakeLines(e.id)
  } else autoLines([e.id])
  return info
}

/** Put videos into episodes in order: empty episodes first, then new E02, E03… Returns the episode ids. */
export async function addEpisodeVideos(paths: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const path of paths) {
    const info = await post<MediaInfo>('/media/probe', { path })
    const p = P().project!
    let id = p.episodes.find((e) => !e.videoPath && !ids.includes(e.id))?.id
    if (!id) {
      const used = new Set(p.episodes.map((e) => e.label))
      let n = p.episodes.length + 1
      while (used.has(episodeLabel(n))) n++
      const e = newEpisode(n)
      mutate((pp) => ({ ...pp, episodes: [...pp.episodes, e] }), { undo: false })
      id = e.id
    }
    setEpisodeVideo(id, info)
    info.warnings.forEach((w) => toast.warning(`${info.name}: ${w}`))
    ids.push(id)
  }
  return ids
}

/** Import Folder: every video in a folder becomes an episode (natural order), then lines start automatically. */
export async function importFolder() {
  const dir = await window.api.openDir({ title: 'Folder with the episode videos' })
  if (!dir) return
  const { files } = await post<{ files: string[] }>('/media/scan-dir', { dir })
  if (!files.length) throw new Error('No video files (.mp4 .mkv .mov .webm .m4v .avi) in that folder')
  toast.info(`Importing ${files.length} episode${files.length > 1 ? 's' : ''}…`)
  const ids = await addEpisodeVideos(files)
  toast.success(`Imported ${ids.length} episode${ids.length > 1 ? 's' : ''}: ${ids.map((id) => P().project!.episodes.find((e) => e.id === id)?.label).join(', ')}`)
  autoLines(ids)
}

export type LinkQuality = 'best' | '1080' | '720' | '480'

/**
 * Import Link: download videos you own / are licensed to dub (one link, or the picked videos of a playlist).
 * Downloads run in the background (jobs panel); each finished video becomes the next episode, in link order,
 * then lines are made automatically.
 */
export async function importLink(urls: string | string[], quality: LinkQuality = '1080') {
  const list = Array.isArray(urls) ? urls : [urls]
  const outDir = `${P().dir}\\downloads`
  const jobs = list.map((url) => runJob<{ path: string; title?: string }>('download', { url, outDir, quality }))
  const added: string[] = []
  let failed = 0
  // add in link order: wait for each in turn (they still download in parallel)
  for (const job of jobs) {
    try {
      const r = await job
      const ids = await addEpisodeVideos([r.path])
      added.push(...ids)
      if (list.length === 1) toast.success(`Downloaded${r.title ? ` “${r.title}”` : ''} → ${P().project!.episodes.find((e) => e.id === ids[0])?.label}`)
      autoLines(ids)
    } catch (e) {
      failed++
      notify(e)
    }
  }
  if (list.length > 1) {
    const labels = added.map((id) => P().project!.episodes.find((e) => e.id === id)?.label).join(', ')
    if (added.length) toast.success(`Downloaded ${added.length} of ${list.length} videos${labels ? `: ${labels}` : ''}`)
    else if (failed) toast.error(`None of the ${list.length} videos could be downloaded`)
  }
  return added
}

/** The project's Source & licence note as plain text (SOURCE.txt). */
export function sourceNote(): string | undefined {
  const p = P().project
  const s = p?.source
  if (!s) return undefined
  return [`Project: ${p!.name}`, `Source: ${s.origin}`, `Licence / permission: ${s.licence}`, s.notes ? `Notes: ${s.notes}` : '', `Exported: ${new Date().toISOString()}`]
    .filter(Boolean)
    .join('\r\n')
}

/** Lines that start after the end of the episode's video: they came from a different (longer) video. */
export const staleLines = (e: Episode) => (e.durationSec > 0 ? e.segments.filter((s) => s.start > e.durationSec + 0.5).length : 0)

/** Replace every line with a fresh Listen + Read of the episode's current video (no extra question). */
export async function remakeLines(epId?: string) {
  return listenReadSrt(epId, { saveSrt: false, ask: false }).catch(notify)
}

/**
 * After a video import: make the dubbing lines automatically (Listen + Read, then translate) for every episode
 * that has a video but no lines yet. Runs one episode at a time in the background; turn off with the "Auto" toggle.
 */
export function autoLines(epIds: string[]) {
  if (!S().autoLines) return
  void (async () => {
    for (const id of epIds) {
      const e = P().project?.episodes.find((x) => x.id === id)
      if (!e?.videoPath || e.segments.length) continue
      await listenReadSrt(id, { saveSrt: false }).catch(notify)
    }
  })()
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
  await castLines(e.id)
}

export function episodeCues(e: Episode, source: 'target' | 'original' = 'target'): Cue[] {
  return sortSegments(e.segments)
    .map((s) => ({ start: s.start, end: s.end, text: (source === 'target' ? s.textTarget || s.textOriginal : s.textOriginal || s.textTarget).trim() }))
    .filter((c) => c.text)
}

export async function exportSubtitles(format: 'srt' | 'vtt', epId?: string) {
  const e = ep(epId)
  if (!episodeCues(e).length) throw new Error('No subtitle lines in this episode yet — run Transcribe or Listen + Read → SRT first')
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
      sourceLang: srcLang(p.settings),
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
  keepDetected(r.language)
  toast.success(`Transcribed ${segs.length} lines`)

  // Gemini returns speakers + gender directly
  const speakerIds = [...new Set(Object.values(speakerOf))]
  if (speakerIds.length) {
    const genders = new Map(r.segments.filter((s) => s.speaker).map((s) => [s.speaker!, (s.gender as Actor['gender']) ?? 'unknown']))
    applyCastFromSpeakers(e.id, speakerIds.map((id) => ({ id, gender: genders.get(id) ?? 'unknown' })), speakerOf)
  }
  // chains
  if (!chain) return assignDefaultActor(e.id)
  await castLines(e.id, speakerIds.length > 0)
  if (engine === 'offline') await translate(e.id, undefined, 'offline')
  else if (engine === 'whisper' || engine === 'gemini-cast') await translate(e.id)
}

// ───────── default cast ─────────

/**
 * Give new lines a cast: detect speakers offline (one actor per voice, male/female from pitch) unless the transcriber
 * already did; anything still without an actor goes to the first actor, created as "A1" if the cast is empty.
 */
export async function castLines(epId: string, haveSpeakers = false) {
  const e = ep(epId)
  if (!e.segments.length) return
  if (!haveSpeakers && e.videoPath && e.segments.length > 1) {
    await diarize(epId).catch((err) => toast.warning(`Couldn't detect speakers (${(err as Error).message.split(/\r?\n/)[0]}) — all lines go to actor A1`))
  }
  assignDefaultActor(epId)
  await fillVoices()
}

/** Lines without an actor → the first actor (A1 is created when the cast is empty); every actor gets a voice. */
export function assignDefaultActor(epId: string) {
  mutate((p) => {
    const e = p.episodes.find((x) => x.id === epId)
    if (!e || e.segments.every((s) => s.actorId)) return p
    const a: Actor = p.cast[0] ?? { id: 'A1', label: 'A1', gender: 'unknown', lines: 0, totalSec: 0, sampleText: '' }
    const cast = p.cast.length ? p.cast : [a]
    const episodes = p.episodes.map((x) => (x.id !== epId ? x : { ...x, segments: x.segments.map((s) => (s.actorId ? s : { ...s, actorId: a.id })) }))
    return { ...p, episodes, cast: actorStats(cast, episodes.flatMap((x) => x.segments)) }
  }, { undo: false })
}

/** Language of an Edge voice id ("edge:km-KH-PisethNeural" → "km"); null for clones / defaults (they speak anything). */
export const voiceLang = (id?: string) => id?.match(/^edge:([a-z]{2,3})-/i)?.[1].toLowerCase() ?? null

/** Make the default male/female voices speak the target language (a Khmer voice can't read Vietnamese). */
export async function syncDefaultVoices(lang: string) {
  const st = S()
  const okM = voiceLang(st.defaultMale) === lang
  const okF = voiceLang(st.defaultFemale) === lang
  if (okM && okF) return
  const voices = (await loadVoices().catch(() => [] as Voice[])).filter((v) => v.engine === 'edge' && v.locale.toLowerCase().startsWith(lang + '-'))
  if (!voices.length) return
  const pick = (g: Voice['gender']) => voices.find((v) => v.gender === g) ?? voices[0]
  const patch: { defaultMale?: string; defaultFemale?: string } = {}
  if (!okM) patch.defaultMale = pick('male').id
  if (!okF) patch.defaultFemale = pick('female').id
  st.set(patch)
  const name = (id?: string) => voices.find((v) => v.id === id)?.name
  toast.info(`Default voices now speak ${lang}: ${[name(patch.defaultMale), name(patch.defaultFemale)].filter(Boolean).join(' / ')}`)
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
  const n = tidyActors()
  await fillVoices()
  toast.success(`Found ${n} speakers`)
}

/** Merge actors with only a few lines into the closest main actor (speaker detection over-splits). Returns the cast size. */
export function tidyActors(maxActors = 10): number {
  let size = 0
  mutate((p) => {
    const all = p.episodes.flatMap((e) => e.segments)
    const { cast, remap } = tidyCast(p.cast, all, maxActors)
    size = cast.length
    if (!Object.keys(remap).length) return p
    const episodes = p.episodes.map((e) => ({ ...e, segments: e.segments.map((s) => (s.actorId && remap[s.actorId] ? { ...s, actorId: remap[s.actorId] } : s)) }))
    return { ...p, episodes, cast: actorStats(cast, episodes.flatMap((e) => e.segments)) }
  })
  return size
}

/** Actors without a voice get one in the target language — each a different voice/variant where possible. */
export async function fillVoices() {
  const p = P().project
  if (!p?.cast.some((a) => !a.voiceId || (voiceLang(a.voiceId) && voiceLang(a.voiceId) !== p.settings.targetLang))) return
  const voices = (await loadVoices().catch(() => [] as Voice[])).filter((v) => !v.id.startsWith('default:'))
  mutate((pp) => {
    const lang = pp.settings.targetLang
    const matched = autoMatchVoices(pp.cast, voices, lang)
    const bad = (id?: string) => !id || (!!voiceLang(id) && voiceLang(id) !== lang)
    return { ...pp, cast: pp.cast.map((a, i) => (bad(a.voiceId) ? { ...a, voiceId: matched[i].voiceId } : a)) }
  }, { undo: false })
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
      sourceLang: srcLang(p.settings),
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

export function voiceFor(s: Segment, cast: Actor[], lang?: string): string {
  const a = cast.find((x) => x.id === s.actorId)
  const fits = (id?: string) => !!id && (!lang || !voiceLang(id) || voiceLang(id) === lang)
  if (fits(s.voiceId)) return s.voiceId!
  if (fits(a?.voiceId)) return a!.voiceId!
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
          voiceId: voiceFor(s, p.cast, st.targetLang),
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
      reverb: st.reverb,
      // imported voice tracks have no line timings: they keep the ducking behaviour
      autoSpans:
        (st.autoOriginal ?? true) && !e.voiceTrack
          ? dubSpans(e.segments.filter((s) => s.audioPath && s.audioDur).map((s) => ({ start: s.start, dur: s.audioDur! })))
          : undefined
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
  /** short side in px; 0/undefined = original size */
  resolution?: number
  /** split into parts of this many minutes (EP01, EP02…); 0/undefined = one full video */
  splitMinutes?: number
}

export async function exportEpisode(opts: ExportOptions, epId?: string) {
  let e = ep(epId)
  needVideo(e)
  const p = P().project!
  let mixPath: string | undefined
  if (opts.mp4 && !opts.originalAudio && (e.segments.some((s) => s.audioPath) || e.voiceTrack)) {
    if (p.settings.globalVolume < 0.05) toast.warning('Dub volume is 0% — the dub voices will be silent in this video. Raise "Dub volume" on the timeline toolbar.', { duration: 10000 })
    if (opts.remix || !e.stems.mix) await mixEpisode(e.id)
    e = ep(e.id)
    mixPath = e.stems.mix
  }
  // an empty cue list used to write blank .srt/.vtt/.ass files and still mark the episode exported
  const cues = episodeCues(e, p.settings.captions.source)
  const wantsSubs = opts.srt || opts.vtt || opts.ass || opts.burn
  const clips = effectiveClips(e.edit)
  const editOn = opts.applyEdit && e.edit.enabled
  // lines can all sit in parts the video edit cuts out — that also gave a blank .srt with no explanation
  const kept = editOn ? mapCuesToOutput(cues, clips).length : cues.length
  if (wantsSubs && !kept) {
    const why = cues.length
      ? `All ${cues.length} subtitle line${cues.length > 1 ? 's are' : ' is'} in parts of the video you cut out`
      : 'No subtitle lines in this episode yet — run Transcribe or Listen + Read → SRT first'
    if (!opts.mp4) throw new Error(why)
    toast.warning(`${why} — exporting the video without subtitles`)
    opts = { ...opts, srt: false, vtt: false, ass: false, burn: false }
  }
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
      cues,
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
      encoder: opts.cpu ? 'cpu' : 'auto',
      fps: e.media?.video?.fps,
      muteOriginal: p.settings.muteOriginal && !opts.originalAudio,
      resolution: opts.resolution || undefined,
      splitMinutes: opts.splitMinutes || undefined,
      sourceNote: sourceNote(),
      watermark: p.settings.watermark
    },
    e.id
  )
  updateEpisode(e.id, (x) => ({ ...x, status: 'exported', exports: r.files }), { undo: false })
  return r.files
}

export const editedDuration = (e: Episode) => (e.edit.enabled ? outputDuration(effectiveClips(e.edit)) : e.durationSec)

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
export async function listenReadSrt(epId?: string, opts: { saveSrt?: boolean; ask?: boolean } = {}) {
  const { saveSrt = true, ask = true } = opts
  const e = ep(epId)
  needVideo(e)
  const p = P().project!
  if (ask && e.segments.length && !confirm(`Replace the ${e.segments.length} existing lines with a new Listen + Read result?`)) return
  toast.info(
    saveSrt
      ? 'Listen + Read started — listening to the speech and reading the screen…'
      : `${e.label}: making dubbing lines automatically — listening to the speech and reading the screen…`
  )

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
  keepDetected(heard.language)
  toast.success(
    m.usedScreen
      ? `Listen + Read: ${segs.length} lines (${Math.round(m.coverage * 100)}% of speech had on-screen subtitles)`
      : `No burned-in subtitles found — ${segs.length} lines from speech`
  )

  await castLines(e.id)
  // translate what isn't translated yet; still save the original SRT if translation fails
  let trErr: unknown
  if (segs.some((s) => !s.textTarget.trim())) await translate(e.id).catch((err) => (trErr = err))
  if (!saveSrt) {
    if (trErr) throw trErr
    toast.success(`${e.label}: ${segs.length} dubbing lines ready — next: Generate Voices`)
    return []
  }

  if (trErr) notify(trErr)
  return saveSrtFiles(e.id)
}

/**
 * One click "Export SRT": original + translated SRT into the project's exports folder (no save dialog to get lost),
 * following the edited timeline when edits are on.
 */
export async function saveSrtFiles(epId?: string) {
  const done = ep(epId)
  const p = P().project!
  const outDir = `${P().dir}\\exports\\${done.label}`
  const map = (cues: Cue[]) => (done.edit.enabled ? mapCuesToOutput(cues, effectiveClips(done.edit)) : cues)
  const base = safeName(`${p.name.trim().slice(0, 60).trim()}_${done.label}`)
  const src = srcLang(p.settings)
  const tgt = p.settings.targetLang
  const files: string[] = []
  const write = async (name: string, cues: Cue[]) => {
    const mapped = map(cues)
    if (!mapped.length) return
    const path = `${outDir}\\${name}`
    await post('/subs/export', { path, cues: mapped, format: 'srt' })
    files.push(path)
  }
  const orig = sortSegments(done.segments).map((s) => ({ start: s.start, end: s.end, text: s.textOriginal.trim() })).filter((c) => c.text)
  const trans = sortSegments(done.segments).map((s) => ({ start: s.start, end: s.end, text: s.textTarget.trim() })).filter((c) => c.text)
  await write(`${base}_${src !== 'auto' ? src : 'original'}.srt`, orig)
  await write(`${base}_${tgt}.srt`, trans)
  if (!files.length) {
    throw new Error(
      orig.length || trans.length
        ? 'All subtitle lines are in parts of the video you cut out'
        : 'No subtitle lines yet — run Listen + Read → SRT or Transcribe first'
    )
  }
  toast.success(`Saved ${files.length} SRT file${files.length > 1 ? 's' : ''} to exports\\${done.label}`, {
    duration: 10000,
    action: { label: 'Show', onClick: () => window.api.showInFolder(files[files.length - 1]) }
  })
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
