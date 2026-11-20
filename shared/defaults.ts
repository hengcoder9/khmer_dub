import type { Episode, Project, ProjectSettings, Segment } from './types'
import { DEFAULT_CAPTIONS } from './captions'

export const uid = (prefix = '') => prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3)

export const DEFAULT_VOICES = {
  male: 'edge:km-KH-PisethNeural',
  female: 'edge:km-KH-SreymomNeural'
}

export const defaultSettings = (): ProjectSettings => ({
  targetLang: 'km',
  sourceLang: 'auto',
  maxSpeed: 1.6,
  autoFit: true,
  ducking: true,
  duckLevelDb: -12,
  syncEnd: true,
  keepOriginal: false,
  origVolume: 0.15,
  muteOriginal: false,
  reverb: false,
  globalSpeed: 1,
  globalPitch: 0,
  globalVolume: 1,
  translator: 'gemini',
  ttsEngine: 'edge',
  sttEngine: 'whisper',
  whisperModel: 'large-v3-turbo',
  captions: { ...DEFAULT_CAPTIONS },
  burnSubtitles: false
})

export const episodeLabel = (n: number) => `E${String(n).padStart(2, '0')}`

export const newEpisode = (n: number): Episode => ({
  id: uid('ep_'),
  label: episodeLabel(n),
  videoPath: '',
  durationSec: 0,
  stems: {},
  segments: [],
  status: 'new',
  edit: { enabled: false, clips: [], removed: [], aspect: 'source', fitMode: 'crop', fadeIn: 0, fadeOut: 0 }
})

export const newProject = (name: string): Project => ({
  id: uid('prj_'),
  name,
  version: 1,
  episodes: [newEpisode(1)],
  glossary: [],
  cast: [],
  settings: defaultSettings()
})

export const newSegment = (start: number, end: number, textOriginal = '', textTarget = ''): Segment => ({
  id: uid('s'),
  start: Math.round(start * 100) / 100,
  end: Math.round(end * 100) / 100,
  textOriginal,
  textTarget,
  speed: 1,
  pitch: 0,
  volume: 1
})

/** Fill fields added in later versions so older project.json files keep working. */
export function migrateProject(p: Project): Project {
  const settings = { ...defaultSettings(), ...p.settings, captions: { ...DEFAULT_CAPTIONS, ...p.settings?.captions } }
  return {
    ...p,
    version: 1,
    glossary: p.glossary ?? [],
    cast: p.cast ?? [],
    settings,
    episodes: (p.episodes ?? []).map((e, i) => ({
      ...newEpisode(i + 1),
      ...e,
      stems: e.stems ?? {},
      edit: { ...newEpisode(i + 1).edit, ...e.edit },
      segments: (e.segments ?? []).map((s) => ({ ...s, speed: s.speed ?? 1, pitch: s.pitch ?? 0, volume: s.volume ?? 1 }))
    }))
  }
}

export const ACTOR_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#e11d48'
]
