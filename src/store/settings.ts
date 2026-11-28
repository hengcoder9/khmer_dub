import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_VOICES } from '@shared/defaults'
import { DEFAULT_CLAUDE_MODEL, type Translator } from '@shared/types'

export type Theme = 'dark' | 'light' | 'system'
export type Lang = 'en' | 'km'
export type ScreenReader = 'gemini' | 'claude' | 'codecraft' | 'offline'
export type Accent = 'cyan' | 'teal' | 'blue' | 'violet' | 'orange' | 'rose' | 'emerald'
export const ACCENTS: Accent[] = ['cyan', 'violet', 'teal', 'blue', 'orange', 'rose', 'emerald']

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
  /** CodeCraft (OpenAI-compatible gateway): base URL from its dashboard, e.g. https://…/v1 */
  codecraftBaseUrl: string
  /** Claude: workspace for an organisation-level key (sent as anthropic-workspace-id) */
  claudeWorkspaceId: string
  codecraftModel: string
  /** which AI reads on-screen subtitles */
  /** who reads on-screen subtitles: an AI with a key, or the offline engine on this PC */
  screenReader: ScreenReader
  claudeModel: string
  defaultMale: string
  defaultFemale: string
  gpuLanes: number
  cloneLanes: number
  /** voice-clone engine: VoxCPM2 speaks Khmer; F5-TTS needs a Khmer checkpoint */
  cloneEngine: 'voxcpm2' | 'f5'
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
  /** studio accent colour */
  accent: Accent
  /** whole-window UI scale (0.8–1.4) */
  uiScale: number
  /** video monitor (left column) width in px when not "big player" */
  playerWidth: number
  /** Automate: episodes processed at the same time */
  batchParallel: number
  /** AI gateway: how requests pick an API key */
  routeMode: 'spread' | 'rotate' | 'adaptive'
  /** local OpenAI-compatible /v1 server for other tools */
  gatewayEnabled: boolean
  gatewayPort: number
  gatewayKey: string
  /** last export resolution (short side px, 0 = original) */
  exportResolution: number
  /** Export → split into parts of N minutes; 0 = full video */
  exportSplitMinutes: number
  /** Export → AI title, description & hashtags (.txt next to the video) */
  exportAiMeta: boolean
  /** polish each Khmer line for the voice (Claude) right before generating voices */
  polishVoice: boolean
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
      codecraftBaseUrl: '',
      claudeWorkspaceId: '',
      codecraftModel: 'gemini-3.1-pro',
      screenReader: 'gemini',
      claudeModel: DEFAULT_CLAUDE_MODEL,
      defaultMale: DEFAULT_VOICES.male,
      defaultFemale: DEFAULT_VOICES.female,
      gpuLanes: 1,
      cloneLanes: 1,
      cloneEngine: 'voxcpm2',
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
      accent: 'violet',
      uiScale: 1,
      playerWidth: 440,
      batchParallel: 2,
      routeMode: 'spread',
      gatewayEnabled: false,
      gatewayPort: 8766,
      gatewayKey: '',
      exportResolution: 0,
      exportSplitMinutes: 0,
      exportAiMeta: false,
      polishVoice: false,
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
      version: 4,
      migrate: (persisted) => {
        const s = persisted as SettingsState
        // v3: Gemini 1.x/2.x models are closed to new users (404) — move to the current Flash
        if (s && /^gemini-[12]\./.test(s.geminiModel ?? '')) s.geminiModel = 'gemini-3.8-flash'
        // v4: speech/image-only models can't read text or pictures — back to the general Flash
        if (s && /(tts|image|live|embed|audio)/i.test(s.geminiModel ?? '')) s.geminiModel = 'gemini-3.8-flash'
        return s
      }
    }
  )
)

/** Cloud LLM + model for the project's translator choice (offline falls back to Gemini for text tasks). */
export function llmChoice(translator: Translator): { provider: 'gemini' | 'openrouter' | 'claude' | 'codecraft'; model: string } {
  const s = useSettings.getState()
  if (translator === 'openrouter') return { provider: 'openrouter', model: s.openrouterModel }
  if (translator === 'codecraft') return { provider: 'codecraft', model: s.codecraftModel || 'gemini-3.1-pro' }
  if (translator === 'claude') return { provider: 'claude', model: s.claudeModel || DEFAULT_CLAUDE_MODEL }
  return { provider: 'gemini', model: s.geminiModel }
}

/** Push key-routing + local gateway settings to the backend (on start and whenever they change). */
export function gatewayPayload() {
  const s = useSettings.getState()
  return {
    enabled: s.gatewayEnabled && !!s.gatewayKey,
    port: s.gatewayPort,
    key: s.gatewayKey,
    models: { gemini: s.geminiModel, claude: s.claudeModel || DEFAULT_CLAUDE_MODEL, openrouter: s.openrouterModel, codecraft: s.codecraftModel }
  }
}

export function newGatewayKey() {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return 'kd-' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
