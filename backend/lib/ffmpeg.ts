import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { MediaInfo } from '../../shared/types'
import { binPath } from './paths'

export interface RunOptions {
  /** total media duration, needed to turn out_time into a percentage */
  durationSec?: number
  /** requires the caller to pass `-progress pipe:1 -nostats` in args */
  onProgress?: (pct: number, outTimeSec: number) => void
  signal?: AbortSignal
  timeoutMs?: number
  /** receives every stderr chunk (the returned stderr is only a 64 KB tail) */
  onStderr?: (chunk: string) => void
  cwd?: string
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

const MAX_TAIL = 64 * 1024

/** Spawn a process with an argument array (never a shell string), so Unicode/Khmer paths and spaces are safe. */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, signal: opts.signal, cwd: opts.cwd })
    let stdout = ''
    let stderr = ''
    let lineBuf = ''
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : null

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-MAX_TAIL * 4)
      if (!opts.onProgress) return
      lineBuf += chunk
      const lines = lineBuf.split(/\r?\n/)
      lineBuf = lines.pop() ?? ''
      for (const line of lines) {
        // out_time_us and (despite its name) out_time_ms are both microseconds
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line)
        if (m) {
          const sec = Number(m[1]) / 1e6
          const pct = opts.durationSec ? Math.min(100, (sec / opts.durationSec) * 100) : 0
          opts.onProgress(pct, sec)
        } else if (line === 'progress=end') {
          opts.onProgress(100, opts.durationSec ?? 0)
        }
      }
    })
    child.stderr.on('data', (chunk: string) => {
      opts.onStderr?.(chunk)
      stderr = (stderr + chunk).slice(-MAX_TAIL)
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

export const runFfmpeg = (args: string[], opts?: RunOptions) =>
  run(binPath('ffmpeg').path, ['-hide_banner', '-nostdin', ...args], opts)

export const runFfprobe = (args: string[], opts?: RunOptions) => run(binPath('ffprobe').path, args, opts)

const PREVIEW_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1'])
const PREVIEW_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])

const parseFps = (r?: string) => {
  if (!r) return 0
  const [n, d] = r.split('/').map(Number)
  return d ? Math.round((n / d) * 1000) / 1000 : n || 0
}

interface ProbeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  channels?: number
  sample_rate?: string
}

export async function probeMedia(path: string): Promise<MediaInfo> {
  const r = await runFfprobe(
    [
      '-v', 'error',
      '-show_entries',
      'format=duration,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate',
      '-of', 'json',
      path
    ],
    { timeoutMs: 30_000 }
  )
  if (r.code !== 0) throw new Error(`ffprobe failed: ${r.stderr.trim() || `exit ${r.code}`}`)
  const json = JSON.parse(r.stdout) as { format?: { duration?: string; format_name?: string }; streams?: ProbeStream[] }
  const streams = json.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video')
  const a = streams.find((s) => s.codec_type === 'audio')
  const { size } = await stat(path)

  const warnings: string[] = []
  if (!v) warnings.push('No video stream found.')
  else if (v.codec_name === 'hevc') warnings.push('HEVC/H.265 video may not preview on every PC (export still works).')
  else if (!PREVIEW_VIDEO.has(v.codec_name ?? '')) warnings.push(`Video codec "${v.codec_name}" can't be previewed (export still works).`)
  if (!a) warnings.push('No audio stream found.')
  else if (!PREVIEW_AUDIO.has(a.codec_name ?? '') && !a.codec_name?.startsWith('pcm_'))
    warnings.push(`Audio codec "${a.codec_name}" can't be previewed (processing still works).`)

  return {
    path,
    name: basename(path),
    sizeBytes: size,
    durationSec: Math.round(Number(json.format?.duration ?? 0) * 100) / 100,
    container: json.format?.format_name ?? '',
    video: v
      ? { codec: v.codec_name ?? '', width: v.width ?? 0, height: v.height ?? 0, fps: parseFps(v.r_frame_rate) }
      : undefined,
    audio: a
      ? { codec: a.codec_name ?? '', channels: a.channels ?? 0, sampleRate: Number(a.sample_rate ?? 0) }
      : undefined,
    warnings
  }
}
