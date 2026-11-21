// yt-dlp: argument builders, output parsing and a cancellable runner (ported from VidGrab's server/ytdlp.js).
// yt-dlp is always spawned with an argument array (never a shell) and the URL always comes after `--`.

import { execFile, spawn } from 'node:child_process'
import { binPath } from '../lib/paths'

export type Quality = 'best' | '1080' | '720' | '480'
export const QUALITIES: Quality[] = ['best', '1080', '720', '480']

export interface LinkVideo {
  type: 'video'
  id: string | null
  title: string
  thumbnail: string | null
  duration: number | null
  uploader: string | null
  site: string | null
  heights: number[]
  isLive: boolean
}
export interface LinkPlaylistEntry {
  index: number
  title: string
  url: string
  duration: number | null
  thumbnail: string | null
}
export interface LinkPlaylist {
  type: 'playlist'
  title: string
  uploader: string | null
  site: string | null
  thumbnail: string | null
  count: number
  truncated: boolean
  entries: LinkPlaylistEntry[]
}

export const PLAYLIST_LIMIT = 300
const MAX_URL = 4096

/** Accepts only absolute http(s) URLs. Returns the normalized string or null. */
export function validateUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s || s.length > MAX_URL) return null
  try {
    const u = new URL(s)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u.href : null
  } catch {
    return null
  }
}

/** mp4 with H.264/AAC preferred at the same resolution, so the preview player and ffmpeg both handle it. */
export function formatFor(q: Quality): string {
  if (q === 'best') return 'bv*+ba/b'
  const h = Number(q)
  return `bv*[height<=${h}]+ba/b[height<=${h}]/b`
}

const PROG = 'KDPROG '
const PP = 'KDPP '
const FILE = 'KDFILE '
const META = 'KDMETA '

function jsRuntime(): { path: string; env: Record<string, string> } {
  // the backend runs in an Electron utility process: reuse Electron as Node for YouTube's JS challenges
  return { path: process.execPath, env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} }
}

function commonArgs(): string[] {
  return ['--no-color', '--encoding', 'utf-8', '--ffmpeg-location', binPath('ffmpeg').path, '--js-runtimes', `node:${jsRuntime().path}`]
}

export function infoArgs(url: string, playlist: boolean): string[] {
  return [...commonArgs(), '-J', '--flat-playlist', playlist ? '--yes-playlist' : '--no-playlist', '--playlist-items', `1:${PLAYLIST_LIMIT}`, '--no-warnings', '--', url]
}

export function downloadArgs(url: string, quality: Quality, outDir: string): string[] {
  return [
    ...commonArgs(),
    '--no-playlist',
    '--newline',
    '--no-mtime',
    '--windows-filenames',
    '--trim-filenames', '160',
    '-f', formatFor(quality),
    '-S', 'res,vcodec:h264,acodec:aac',
    '--merge-output-format', 'mp4',
    '--remux-video', 'mp4',
    '-P', outDir,
    '-o', '%(title).120B [%(id)s]%(height& {}p|)s.%(ext)s',
    '--print', `before_dl:${META}%(.{title,extractor_key,duration})j`,
    '--print', `after_move:${FILE}%(filepath)s`,
    '--no-quiet',
    '--progress',
    '--progress-template',
    `download:${PROG}%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s`,
    '--progress-template',
    `postprocess:${PP}%(progress.status)s|%(progress.postprocessor)s`,
    '--',
    url
  ]
}

const num = (s?: string) => {
  if (s == null || s === 'NA' || s === 'None' || s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export type YtEvent =
  | { type: 'progress'; status: string; downloaded: number | null; total: number | null; speed: number | null; eta: number | null; fragIndex: number | null; fragCount: number | null }
  | { type: 'postprocess'; status: string; name: string }
  | { type: 'file'; path: string }
  | { type: 'meta'; title: string | null; site: string | null; duration: number | null }
  | { type: 'parts'; count: number }
  | { type: 'part' }
  | { type: 'error'; message: string }

export function parseLine(raw: string): YtEvent | null {
  const line = raw.replace(/\r$/, '')
  if (line.startsWith(PROG)) {
    const [status, dl, total, est, speed, eta, fi, fc] = line.slice(PROG.length).split('|')
    return { type: 'progress', status, downloaded: num(dl), total: num(total) ?? num(est), speed: num(speed), eta: num(eta), fragIndex: num(fi), fragCount: num(fc) }
  }
  if (line.startsWith(PP)) {
    const [status, name] = line.slice(PP.length).split('|')
    return { type: 'postprocess', status, name }
  }
  if (line.startsWith(FILE)) return { type: 'file', path: line.slice(FILE.length).trim() }
  if (line.startsWith(META)) {
    try {
      const m = JSON.parse(line.slice(META.length))
      return {
        type: 'meta',
        title: typeof m.title === 'string' ? m.title : null,
        site: typeof m.extractor_key === 'string' ? m.extractor_key : null,
        duration: Number.isFinite(m.duration) ? m.duration : null
      }
    } catch {
      return null
    }
  }
  let m = line.match(/^\[info\] .*Downloading \d+ format\(s\): (\S+)/)
  if (m) return { type: 'parts', count: m[1].split('+').length }
  if (/^\[download\] Destination: /.test(line) || /^\[download\] .+ has already been downloaded/.test(line)) return { type: 'part' }
  m = line.match(/^ERROR: (.*)/)
  if (m) return { type: 'error', message: m[1] }
  return null
}

const thumbOf = (x: any): string | null => {
  if (typeof x.thumbnail === 'string') return x.thumbnail
  const list = Array.isArray(x.thumbnails) ? x.thumbnails.filter((t: any) => t && typeof t.url === 'string') : []
  const sized = list.filter((t: any) => t.width && t.width <= 1280).sort((a: any, b: any) => b.width - a.width)
  return (sized[0] ?? list[list.length - 1])?.url ?? null
}

export function summarizeInfo(info: any): LinkVideo | LinkPlaylist {
  if (info._type === 'playlist' || Array.isArray(info.entries)) {
    const entries: LinkPlaylistEntry[] = []
    for (const [i, e] of (info.entries ?? []).entries()) {
      if (!e) continue
      const url = validateUrl(e.url) ?? validateUrl(e.webpage_url) ?? validateUrl(e.original_url)
      if (!url || e._type === 'playlist') continue
      entries.push({
        index: Number.isInteger(e.playlist_index) ? e.playlist_index : i + 1,
        title: e.title || `#${i + 1}`,
        url,
        duration: Number.isFinite(e.duration) ? e.duration : null,
        thumbnail: thumbOf(e)
      })
    }
    return {
      type: 'playlist',
      title: info.title || 'Playlist',
      uploader: info.uploader || info.channel || null,
      site: info.extractor_key || info.extractor || null,
      thumbnail: thumbOf(info) ?? entries.find((e) => e.thumbnail)?.thumbnail ?? null,
      count: Number.isInteger(info.playlist_count) ? info.playlist_count : entries.length,
      truncated: entries.length >= PLAYLIST_LIMIT,
      entries
    }
  }
  const heights = [
    ...new Set<number>((info.formats ?? []).filter((f: any) => f.vcodec && f.vcodec !== 'none' && Number(f.height) > 0).map((f: any) => Number(f.height)))
  ].sort((a, b) => b - a)
  if (!heights.length && Number(info.height) > 0) heights.push(Number(info.height))
  return {
    type: 'video',
    id: info.id ?? null,
    title: info.title || info.fulltitle || 'Untitled',
    thumbnail: thumbOf(info),
    duration: Number.isFinite(info.duration) ? info.duration : null,
    uploader: info.uploader || info.channel || info.creator || null,
    site: info.extractor_key || info.extractor || null,
    heights,
    isLive: !!info.is_live
  }
}

/** yt-dlp spawns ffmpeg: take the whole process tree down on cancel. */
function killTree(pid?: number) {
  if (!pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  else
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
}

export interface YtRun {
  code: number
  stdout: string
  errors: string[]
  tail: string[]
}

/** Run yt-dlp; every output line (stdout + stderr) goes to onLine. Rejects with "Canceled" on abort. */
export function runYtdlp(args: string[], opts: { signal?: AbortSignal; cwd?: string; onLine?: (line: string) => void; keepStdout?: boolean; timeoutMs?: number } = {}): Promise<YtRun> {
  const bin = binPath('yt-dlp')
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error('Canceled'))
    const child = spawn(bin.path, args, {
      cwd: opts.cwd,
      windowsHide: true,
      env: { ...process.env, ...jsRuntime().env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    })
    let stdout = ''
    const errors: string[] = []
    const tail: string[] = []
    const onAbort = () => killTree(child.pid)
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = opts.timeoutMs ? setTimeout(onAbort, opts.timeoutMs) : null
    const splitter = () => {
      let buf = ''
      return {
        push(chunk: string) {
          buf += chunk
          const lines = buf.split(/\r?\n|\r(?!\n)/)
          buf = lines.pop() ?? ''
          for (const l of lines) if (l) handle(l)
        },
        end() {
          if (buf) handle(buf)
          buf = ''
        }
      }
    }
    const handle = (l: string) => {
      const err = l.match(/^ERROR: (.*)/)
      if (err) errors.push(err[1])
      tail.push(l)
      if (tail.length > 20) tail.shift()
      opts.onLine?.(l)
    }
    const out = splitter()
    const er = splitter()
    child.stdout.setEncoding('utf8').on('data', (d: string) => (opts.keepStdout ? (stdout += d) : out.push(d)))
    child.stderr.setEncoding('utf8').on('data', (d: string) => er.push(d))
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      reject(
        e.code === 'ENOENT'
          ? new Error('yt-dlp was not found. Run "npm run fetch:ytdlp" (or put yt-dlp.exe in resources/bin).')
          : e
      )
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      out.end()
      er.end()
      if (opts.signal?.aborted) return reject(new Error('Canceled'))
      resolve({ code: code ?? -1, stdout, errors, tail })
    })
  })
}

/** Friendlier wording for the most common yt-dlp failures. */
export function explainError(msg: string): string {
  if (/DRM/i.test(msg)) return 'This video is DRM-protected and cannot be downloaded.'
  if (/Sign in to confirm|login required|cookies/i.test(msg)) return `The site requires sign-in for this video. ${msg}`
  if (/HTTP Error 403/i.test(msg)) return `The site blocked the request (403). Try again, pick a lower quality, or update yt-dlp (npm run fetch:ytdlp -- --force). ${msg}`
  if (/Unsupported URL/i.test(msg)) return 'This site is not supported. Use a direct link to a video file instead.'
  return msg
}
