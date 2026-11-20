// Types shared by electron main/preload, backend and renderer.

export const APP_NAME = 'KhmerDub Studio'

// ───────────────────────── bridge ─────────────────────────

export interface BackendInfo {
  port: number
  token: string
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface KeyEntry {
  id: string
  provider: 'gemini' | 'openrouter' | 'claude'
  /** masked, e.g. "AIza…x9Q2" — real key never leaves the main/backend processes */
  masked: string
  label?: string
}

export interface UpdateInfo {
  state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error'
  current: string
  version?: string
  notes?: string
  percent?: number
  error?: string
}

export interface KdApi {
  getBackend(): Promise<BackendInfo>
  openFile(opts?: { title?: string; filters?: FileFilter[] }): Promise<string | null>
  openFiles(opts?: { title?: string; filters?: FileFilter[] }): Promise<string[]>
  openDir(opts?: { title?: string }): Promise<string | null>
  saveFile(opts?: { title?: string; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>
  showInFolder(path: string): Promise<void>
  /** open a file with its default app (e.g. play an exported MP4) */
  openPath(path: string): Promise<string>
  getAppInfo(): Promise<{ name: string; version: string; documents: string }>
  keys: {
    list(): Promise<KeyEntry[]>
    add(provider: KeyEntry['provider'], key: string, label?: string): Promise<KeyEntry[]>
    remove(id: string): Promise<KeyEntry[]>
  }
  update: {
    check(): Promise<UpdateInfo>
    download(): Promise<void>
    install(): Promise<void>
    onStatus(cb: (u: UpdateInfo) => void): () => void
  }
}

// ───────────────────────── health ─────────────────────────

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'later'

export interface CheckDef {
  id: string
  label: string
  phase?: number
}

export interface CheckResult {
  id: string
  status: CheckStatus
  detail: string
  ms: number
}

export interface MediaInfo {
  path: string
  name: string
  sizeBytes: number
  durationSec: number
  container: string
  video?: { codec: string; width: number; height: number; fps: number }
  audio?: { codec: string; channels: number; sampleRate: number }
  warnings: string[]
}

export interface SystemStats {
  memTotal: number
  memFree: number
  diskTotal: number
  diskFree: number
}

// ───────────────────────── project model ─────────────────────────

export interface Word {
  start: number
  end: number
  text: string
}

export interface Segment {
  id: string
  start: number
  end: number
  textOriginal: string
  textTarget: string
  actorId?: string
  voiceId?: string
  speed: number
  pitch: number
  volume: number
  audioPath?: string
  audioDur?: number
  /** speed-up applied by auto-fit (separate from the user's base `speed` so it never compounds) */
  fitSpeed?: number
  fitWarning?: boolean
  words?: Word[]
}

export type Gender = 'male' | 'female' | 'unknown'

export interface Actor {
  id: string
  label: string
  name?: string
  gender: Gender
  voiceId?: string
  lines: number
  totalSec: number
  sampleText: string
  /** speaker embedding centroid, used to match the same actor across episodes */
  embedding?: number[]
}

export interface Range {
  start: number
  end: number
}

/** ffmpeg xfade names; preview approximates them with a dip */
export type TransitionType = 'fade' | 'fadeblack' | 'fadewhite' | 'dissolve' | 'slideleft' | 'slideright' | 'wipeleft' | 'wiperight' | 'circleopen' | 'zoomin'

export interface ClipColor {
  /** -1..1, 0 = unchanged */
  brightness: number
  /** 0..2, 1 = unchanged */
  contrast: number
  /** 0..3, 1 = unchanged */
  saturation: number
}

export interface Clip extends Range {
  id: string
  /** playback speed, 0.25..4 (default 1) */
  speed?: number
  /** audio gain for this clip, 0..2 (default 1) */
  volume?: number
  color?: ClipColor
  /** transition from this clip into the next one (overlaps both by `duration`) */
  transition?: { type: TransitionType; duration: number }
}

export type Aspect = 'source' | '16:9' | '9:16' | '1:1' | '4:5'

export interface EditState {
  /** when false the video is exported as-is (no cuts / reframing) */
  enabled: boolean
  /** user-arranged source clips, in output order */
  clips: Clip[]
  /** source ranges removed by text-cutting, silence removal or AI; subtracted from clips */
  removed: Range[]
  aspect: Aspect
  fitMode: 'crop' | 'pad' | 'blur'
  fadeIn: number
  fadeOut: number
  bgm?: { path: string; volume: number; loop: boolean }
}

export type CaptionMode = 'line' | 'karaoke' | 'word'

export interface CaptionStyle {
  preset: string
  font: string
  size: number
  primary: string // #RRGGBB
  highlight: string
  outlineColor: string
  outline: number
  shadow: number
  bold: boolean
  box: boolean
  boxColor: string
  position: 'bottom' | 'middle' | 'top'
  marginV: number
  mode: CaptionMode
  source: 'target' | 'original'
}

export type EpisodeStatus = 'new' | 'separated' | 'transcribed' | 'translated' | 'voiced' | 'mixed' | 'exported'

export interface Episode {
  id: string
  label: string
  videoPath: string
  durationSec: number
  media?: MediaInfo
  stems: { full?: string; vocals?: string; instrumental?: string; audio16k?: string; dub?: string; mix?: string }
  /** externally produced voice track ("Import AI Voice"), replaces generated lines in the mix */
  voiceTrack?: string
  exports?: string[]
  segments: Segment[]
  status: EpisodeStatus
  edit: EditState
}

export type Translator = 'gemini' | 'openrouter' | 'claude' | 'offline'

/** Default Claude model for translation / AI edit (the user can change it in Settings → API Keys). */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'
export type TtsEngine = 'edge' | 'clone'
export type SttEngine = 'gemini-direct' | 'whisper' | 'gemini-cast' | 'offline'

export interface ProjectSettings {
  targetLang: string
  sourceLang: string
  maxSpeed: number
  autoFit: boolean
  ducking: boolean
  duckLevelDb: number
  syncEnd: boolean
  /** use the original mix at low volume instead of the instrumental stem */
  keepOriginal: boolean
  origVolume: number
  muteOriginal: boolean
  /** original sound off while a dub line (A1) speaks, back on in the gaps (default on; missing = on) */
  autoOriginal?: boolean
  reverb: boolean
  globalSpeed: number
  globalPitch: number
  globalVolume: number
  translator: Translator
  ttsEngine: TtsEngine
  sttEngine: SttEngine
  whisperModel: string
  captions: CaptionStyle
  burnSubtitles: boolean
}

export interface Project {
  id: string
  name: string
  version: 1
  episodes: Episode[]
  glossary: { source: string; target: string }[]
  cast: Actor[]
  settings: ProjectSettings
}

// ───────────────────────── voices ─────────────────────────

export interface Voice {
  id: string // e.g. "edge:km-KH-PisethNeural" or "clone:abc123"
  engine: TtsEngine
  name: string
  gender: Gender
  locale: string
}

export interface CloneVoice {
  id: string
  name: string
  gender: Gender
  refAudio: string
  refText: string
}

// ───────────────────────── jobs ─────────────────────────

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export interface JobInfo {
  id: string
  type: string
  label: string
  episodeId?: string
  status: JobStatus
  progress: number // 0–100
  message?: string
  error?: string
  result?: unknown
  createdAt: number
  finishedAt?: number
}

export type ServerEvent =
  | { type: 'job'; job: JobInfo }
  | { type: 'keys'; total: number; ready: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
