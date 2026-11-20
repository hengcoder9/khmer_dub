// Waveform peaks (100/s) and video thumbnails, cached on disk.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { binPath, cacheDir } from './paths'
import { runFfmpeg } from './ffmpeg'

const PEAKS_PER_SEC = 100
const RATE = 8000
const SAMPLES_PER_PEAK = RATE / PEAKS_PER_SEC

const keyOf = (path: string, extra = '') => {
  const st = statSync(path)
  return createHash('sha1').update(`${path}|${st.size}|${st.mtimeMs}|${extra}`).digest('hex').slice(0, 24)
}

const inflight = new Map<string, Promise<{ rate: number; peaks: number[] }>>()

export function getPeaks(path: string): Promise<{ rate: number; peaks: number[] }> {
  const key = keyOf(path)
  const file = join(cacheDir, 'peaks', `${key}.json`)
  if (existsSync(file)) return Promise.resolve(JSON.parse(readFileSync(file, 'utf8')))
  if (inflight.has(key)) return inflight.get(key)!
  const job = new Promise<{ rate: number; peaks: number[] }>((resolve, reject) => {
    const proc = spawn(binPath('ffmpeg').path, ['-hide_banner', '-nostdin', '-i', path, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'], {
      windowsHide: true
    })
    const peaks: number[] = []
    let max = 0
    let count = 0
    let carry: Buffer | null = null
    proc.stdout.on('data', (d: Buffer) => {
      const buf = carry ? Buffer.concat([carry, d]) : d
      const usable = buf.length - (buf.length % 2)
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i))
        if (v > max) max = v
        if (++count === SAMPLES_PER_PEAK) {
          peaks.push(Math.round((max / 32768) * 1000) / 1000)
          max = 0
          count = 0
        }
      }
      carry = usable < buf.length ? buf.subarray(usable) : null
    })
    proc.stderr.resume()
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0 && !peaks.length) return reject(new Error(`ffmpeg peaks failed (${code})`))
      if (count) peaks.push(Math.round((max / 32768) * 1000) / 1000)
      const result = { rate: PEAKS_PER_SEC, peaks }
      mkdirSync(join(cacheDir, 'peaks'), { recursive: true })
      writeFileSync(file, JSON.stringify(result))
      resolve(result)
    })
  }).finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

export async function getThumb(path: string, t: number, width = 160): Promise<Buffer> {
  const ts = Math.max(0, Math.round(t * 10) / 10)
  const key = keyOf(path, `${ts}|${width}`)
  const file = join(cacheDir, 'thumbs', `${key}.jpg`)
  if (existsSync(file)) return readFileSync(file)
  mkdirSync(join(cacheDir, 'thumbs'), { recursive: true })
  const r = await runFfmpeg(['-y', '-ss', String(ts), '-i', path, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '6', file], { timeoutMs: 20_000 })
  if (r.code !== 0 || !existsSync(file)) throw new Error('Thumbnail failed')
  return readFileSync(file)
}
