// Renders voice effects and sound effects as 44.1 kHz mono 16-bit WAV (what mixDub places), cached by content.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { VOICE_FX, builtinId, sfxById, type VoiceFx } from '../../shared/fx'
import { runFfmpeg } from './ffmpeg'
import { cacheDir } from './paths'

const dir = (sub: string) => {
  const d = join(cacheDir, sub)
  mkdirSync(d, { recursive: true })
  return d
}
const key = (...parts: Array<string | number>) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20)
const WAV = ['-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le']

async function render(args: string[], out: string, what: string): Promise<string> {
  if (existsSync(out)) return out
  const tmp = `${out}.tmp.wav`
  const r = await runFfmpeg(['-y', ...args, ...WAV, tmp])
  if (r.code !== 0) throw new Error(`${what} failed: ${r.stderr.trim().split(/\r?\n/).slice(-2).join(' ')}`)
  const { renameSync } = await import('node:fs')
  renameSync(tmp, out)
  return out
}

/** A voice clip with an effect on it (cached: same file + same effect = same output). */
export async function fxClip(path: string, fx: VoiceFx): Promise<string> {
  const def = VOICE_FX[fx]
  if (!def) return path
  const st = statSync(path)
  const out = join(dir('fx'), `${key(path, st.size, st.mtimeMs, fx)}.wav`)
  return render(['-i', path, '-af', `aresample=44100,${def.chain}`], out, `Voice effect "${def.name}"`)
}

/** A sound effect ("builtin:boom" or a file) as a mixable WAV. */
export async function sfxWav(src: string): Promise<string> {
  const id = builtinId(src)
  if (id) {
    const def = sfxById(id)
    if (!def) throw new Error(`Unknown sound effect: ${id}`)
    return render(['-f', 'lavfi', '-i', def.src, '-af', 'alimiter=limit=0.9'], join(dir('sfx'), `${id}-v1.wav`), `Sound "${def.name}"`)
  }
  if (!existsSync(src)) throw new Error(`Sound file not found: ${src}`)
  const st = statSync(src)
  return render(['-i', src, '-vn', '-t', '30'], join(dir('sfx'), `${key(src, st.size, st.mtimeMs)}.wav`), 'Sound file')
}
