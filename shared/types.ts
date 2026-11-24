// Types shared by electron main/preload, backend and renderer.

export const APP_NAME = 'KhmerDub Studio'
/** Where users get news and help */
export const CONTACT = {
  channel: 'https://t.me/HengShopApp',
  support: 'https://t.me/ChheangHeng369'
} as const

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
  provider: 'gemini' | 'openrouter' | 'claude' | 'codecraft'
  /** masked, e.g. "AIza…x9Q2" — real key never leaves the main/backend processes */
  masked: string
  label?: string
  /** handed out by the admin's server — can be used but not seen or removed */
  shared?: boolean
}

export interface UpdateInfo {
  state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error'
  current: string
  version?: string
  notes?: string
  percent?: number
  error?: string
}

// ───────────────────────── studio account ─────────────────────────

/** Account server (PHP, see server/) — live on GoDaddy cPanel. For local testing, change it under Account → Account server. */
export const ACCOUNT_SERVER = 'https://miennams.net/khmerdub/api/'

export interface AccountUser {
  id: number
  email: string
  name: string
  role: 'user' | 'admin'
  status: 'active' | 'disabled'
  createdAt: string
  /** how the account was created */
  provider?: 'email' | 'google' | 'telegram'
  /** Google connected */
  google?: boolean
  /** Telegram username ("connected" when it has none), null = not connected */
  telegram?: string | null
  /** profile picture from Google / Telegram */
  avatar?: string | null
  /** false for Google / Telegram accounts that never set a password */
  hasPassword?: boolean
}

export interface AccountAccess {
  active: boolean
  kind: 'lifetime' | 'paid' | 'trial' | 'none'
  plan: string | null
  planCode: string | null
  /** UTC "YYYY-MM-DD HH:MM:SS"; null = lifetime / none */
  endsAt: string | null
  daysLeft: number | null
  trialEndsAt: string | null
}

export interface AccountState {
  server: string
  signedIn: boolean
  user: AccountUser | null
  access: AccountAccess | null
  /** ms epoch of the last successful check with the server */
  checkedAt: number
}

export type AccountResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; offline?: boolean; signedOut?: boolean }

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
  /** whole-window UI scale (1 = 100 %) */
  setZoom(factor: number): void
  account: {
    state(): Promise<AccountState>
    call<T = unknown>(path: string, body?: unknown): Promise<AccountResult<T>>
    setServer(url: string): Promise<AccountState>
    signOutLocal(): Promise<AccountState>
    openAdmin(): Promise<void>
    openPayUrl(url: string): Promise<void>
  }
  keys: {
    list(): Promise<KeyEntry[]>
    add(provider: KeyEntry['provider'], key: string, label?: string): Promise<KeyEntry[]>
    remove(id: string): Promise<KeyEntry[]>
    /** pull the admin's shared keys + your saved keys from the account server, push new local keys up */
    sync(): Promise<KeyEntry[]>
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

export interface GpuStats {
  name: string
  /** MiB */
  memUsed: number
  memTotal: number
  /** 0–100 */
  load: number
}

export interface SystemStats {
  memTotal: number
  memFree: number
  diskTotal: number
  diskFree: number
  /** 0–100, averaged over all cores since the previous call */
  cpu?: number
  cores?: number
  gpu?: GpuStats | null
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
  /** what the voice says when it differs from the subtitle (numbers spelled out, Latin words in Khmer script…) */
  textSpoken?: string
  /** the subtitle text `textSpoken` was made from; when the subtitle changes, the voice reads the subtitle again */
  spokenFor?: string
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

export type Translator = 'gemini' | 'openrouter' | 'claude' | 'codecraft' | 'offline'

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
  /** your logo / channel badge on exported videos */
  watermark?: Watermark
  /** hide the source video's own burned-in subtitles under a blur or a bar */
  subCover?: SubCover
}

/** Area over the old (burned-in) subtitles, as fractions of the SOURCE frame, blurred or covered in the export. */
export interface SubCover {
  enabled: boolean
  x: number
  y: number
  w: number
  h: number
  /** blur = soft blur (keeps the picture's colours); box = solid bar */
  mode: 'blur' | 'box'
  /** blur strength 1 (light) … 3 (strong) */
  strength?: number
  /** bar colour (#RRGGBB) and opacity, for mode 'box' */
  color?: string
  opacity?: number
}

export type WatermarkAnimation = 'none' | 'pulse' | 'corners' | 'scroll' | 'float'

export interface Watermark {
  /** logo image; empty = text-only watermark */
  path: string
  /** text watermark, e.g. a channel name or @handle (Khmer works) */
  text?: string
  textColor?: string
  /** text height as a fraction of the shorter side */
  textSize?: number
  animation?: WatermarkAnimation
  /** seconds per animation cycle */
  every?: number
  position: 'tl' | 'tr' | 'bl' | 'br' | 'center'
  /** width as a fraction of the video width */
  size: number
  /** 0..1 */
  opacity: number
  /** distance from the edge, fraction of the shorter side */
  margin: number
}

/** Where the episodes come from and the permission to dub them. */
export interface ProjectSource {
  origin: string
  licence: string
  notes?: string
}

export interface Project {
  id: string
  name: string
  version: 1
  episodes: Episode[]
  glossary: { source: string; target: string }[]
  cast: Actor[]
  settings: ProjectSettings
  source?: ProjectSource
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
