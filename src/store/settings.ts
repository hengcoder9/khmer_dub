import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_VOICES } from '@shared/defaults'
import { DEFAULT_CLAUDE_MODEL, type Translator } from '@shared/types'

export type Theme = 'dark' | 'light' | 'system'
export type Lang = 'en' | 'km'

export interface Recent {
  name: string
  dir: string
  openedAt: number
}

interface SettingsState {
  theme: Theme
  lang: Lang
  volume: number
  geminiModel: string
  openrouterModel: string
  claudeModel: string
  defaultMale: string
  defaultFemale: string
  gpuLanes: number
  cloneLanes: number
  cloneModel: string
  cloneCkpt: string
  cloneVocab: string
  dictionary: Array<{ from: string; to: string }>
  recent: Recent[]
  ocrInterval: number
  ocrCropTop: number
  silenceDb: number
  silenceMin: number
  showSubtitles: boolean
  /** player column takes half the window */
  bigPlayer: boolean
  /** last export resolution (short side px, 0 = original) */
  exportResolution: number
  /** make dubbing lines (Listen + Read, then translate) as soon as a video is imported */
  autoLines: boolean
  set: (patch: Partial<Omit<SettingsState, 'set' | 'addRecent'>>) => void
  addRecent: (r: Omit<Recent, 'openedAt'>) => void
  // legacy setters used by Phase 1 components
  setTheme: (t: Theme) => void
  setLang: (l: Lang) => void
  setVolume: (v: number) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      lang: 'en',
      volume: 1,
      geminiModel: 'gemini-3.8-flash',
      openrouterModel: 'google/gemini-2.5-flash',
      claudeModel: DEFAULT_CLAUDE_MODEL,
      defaultMale: DEFAULT_VOICES.male,
      defaultFemale: DEFAULT_VOICES.female,
      gpuLanes: 1,
      cloneLanes: 1,
      cloneModel: 'F5TTS_v1_Base',
      cloneCkpt: '',
      cloneVocab: '',
      dictionary: [],
      recent: [],
      ocrInterval: 1,
      ocrCropTop: 0.65,
      silenceDb: -35,
      silenceMin: 0.8,
      showSubtitles: true,
      bigPlayer: false,
      exportResolution: 0,
      autoLines: true,
      set: (patch) => set(patch),
      addRecent: (r) =>
        set((s) => ({ recent: [{ ...r, openedAt: Date.now() }, ...s.recent.filter((x) => x.dir !== r.dir)].slice(0, 12) })),
      setTheme: (theme) => set({ theme }),
      setLang: (lang) => set({ lang }),
      setVolume: (volume) => set({ volume })
    }),
    // new fields fall back to defaults via the shallow merge; keep whatever was stored
    {
      name: 'kd-settings',
      version: 3,
      migrate: (persisted) => {
        const s = persisted as SettingsState
        // v3: Gemini 1.x/2.x models are closed to new users (404) — move to the current Flash
        if (s && /^gemini-[12]\./.test(s.geminiModel ?? '')) s.geminiModel = 'gemini-3.8-flash'
        return s
      }
    }
  )
)

/** Cloud LLM + model for the project's translator choice (offline falls back to Gemini for text tasks). */
export function llmChoice(translator: Translator): { provider: 'gemini' | 'openrouter' | 'claude'; model: string } {
  const s = useSettings.getState()
  if (translator === 'openrouter') return { provider: 'openrouter', model: s.openrouterModel }
  if (translator === 'claude') return { provider: 'claude', model: s.claudeModel || DEFAULT_CLAUDE_MODEL }
  return { provider: 'gemini', model: s.geminiModel }
}
