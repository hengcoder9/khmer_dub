import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { runFfmpeg } from '../lib/ffmpeg'
import type { JobCtx } from '../queue'

/** True when `out` exists and is newer than `src`. */
export const fresh = (out: string, src: string) => {
  try {
    return existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs && statSync(out).size > 1000
  } catch {
    return false
  }
}

export function ffFail(what: string, stderr: string): Error {
  const lines = stderr.trim().split(/\r?\n/).filter((l) => !/^\s*(frame|size)=/.test(l))
  return new Error(`${what} failed: ${lines.slice(-4).join(' | ') || 'unknown ffmpeg error'}`)
}

/** full.wav (44.1 kHz stereo) + audio16k.wav (16 kHz mono) in one ffmpeg pass. */
export async function ensureAudio(
  videoPath: string,
  epDir: string,
  durationSec: number,
  ctx?: JobCtx,
  span: [number, number] = [0, 100]
): Promise<{ full: string; audio16k: string }> {
  mkdirSync(epDir, { recursive: true })
  const full = join(epDir, 'full.wav')
  const audio16k = join(epDir, 'audio16k.wav')
  if (fresh(full, videoPath) && fresh(audio16k, videoPath)) return { full, audio16k }
  ctx?.progress(span[0], 'Extracting audio')
  const r = await runFfmpeg(
    [
      '-y', '-i', videoPath,
      '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', full,
      '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio16k,
      '-progress', 'pipe:1', '-nostats'
    ],
    {
      durationSec,
      signal: ctx?.signal,
      onProgress: (p) => ctx?.progress(span[0] + ((span[1] - span[0]) * p) / 100, 'Extracting audio')
    }
  )
  if (r.code !== 0) {
    if (/matches no streams|Output file is empty|does not contain any stream/i.test(r.stderr)) {
      const dur = Math.max(0.1, durationSec || 1)
      await runFfmpeg(
        [
          '-y',
          '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-t', dur.toFixed(3), '-c:a', 'pcm_s16le', full,
          '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=16000', '-t', dur.toFixed(3), '-c:a', 'pcm_s16le', audio16k
        ],
        { signal: ctx?.signal }
      )
      return { full, audio16k }
    }
    throw ffFail('Audio extraction', r.stderr)
  }
  return { full, audio16k }
}

/** ffmpeg silencedetect → silent ranges. */
export async function detectSilences(
  path: string,
  opts: { noiseDb?: number; minDur?: number; durationSec?: number; signal?: AbortSignal } = {}
): Promise<Array<{ start: number; end: number }>> {
  const kept: string[] = []
  let partial = ''
  const r = await runFfmpeg(
    ['-i', path, '-vn', '-af', `silencedetect=noise=${opts.noiseDb ?? -35}dB:d=${opts.minDur ?? 0.5}`, '-f', 'null', '-'],
    {
      signal: opts.signal,
      onStderr: (c) => {
        const lines = (partial + c).split(/\r?\n/)
        partial = lines.pop() ?? ''
        for (const l of lines) if (l.includes('silence_')) kept.push(l)
      }
    }
  )
  if (r.code !== 0) throw ffFail('Silence detection', r.stderr)
  if (partial.includes('silence_')) kept.push(partial)
  return parseSilences(kept.join('\n'), opts.durationSec)
}

export function parseSilences(stderr: string, durationSec?: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  let start: number | null = null
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line)
    if (s) start = Math.max(0, Number(s[1]))
    const e = /silence_end:\s*([\d.]+)/.exec(line)
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) })
      start = null
    }
  }
  if (start !== null && durationSec) out.push({ start, end: durationSec })
  return out
}
