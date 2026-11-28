import { existsSync, writeFileSync } from 'node:fs'
import type { Range } from '../../shared/types'
import { dubOnExpr } from '../../shared/ranges'
import { join } from 'node:path'
import { mixDub } from '../lib/audio'
import { runFfmpeg } from '../lib/ffmpeg'
import { ensureAudio, ffFail } from './extract'
import type { JobCtx } from '../queue'
import type { VoiceFx } from '../../shared/fx'
import { fxClip, sfxWav } from '../lib/fxrender'

export interface MixPayload {
  videoPath: string
  epDir: string
  durationSec: number
  clips: Array<{ path: string; start: number; gain: number; fx?: VoiceFx }>
  /** sound effects placed on the video: "builtin:boom" or a file, at a time, with a volume */
  sfx?: Array<{ src: string; start: number; volume: number }>
  /** externally made voice track ("Import AI Voice") used instead of generated clips */
  voiceTrack?: string
  instrumental?: string
  bgm?: { path: string; volume: number; loop: boolean }
  ducking: boolean
  duckLevelDb: number
  keepOriginal: boolean
  origVolume: number
  muteOriginal: boolean
  reverb: boolean
  /** Auto original: dub line spans; the original is off inside them, on outside (the instrumental fills in under the dub) */
  autoSpans?: Range[]
}

/**
 * dub.wav = clips on a silent track. mix.wav = background (instrumental, or original at low volume)
 * ducked under the dub with sidechaincompress, + optional BGM, limited and loudness-normalized to -14 LUFS.
 */
export async function mix(p: MixPayload, ctx: JobCtx): Promise<{ dub: string; mix: string }> {
  const { full } = await ensureAudio(p.videoPath, p.epDir, p.durationSec, ctx, [0, 10])
  const dub = p.voiceTrack && existsSync(p.voiceTrack) ? p.voiceTrack : join(p.epDir, 'dub.wav')
  if (dub === join(p.epDir, 'dub.wav')) {
    const clips = p.clips.filter((c) => existsSync(c.path))
    // voice effects (echo, radio, robot…) rendered per clip, cached
    const withFx = clips.filter((c) => c.fx)
    for (const [k, c] of withFx.entries()) {
      ctx.throwIfCanceled()
      ctx.progress(5 + (5 * k) / withFx.length, `Voice effects ${k + 1} of ${withFx.length}`)
      c.path = await fxClip(c.path, c.fx!)
    }
    ctx.progress(10, `Placing ${clips.length} voice clips`)
    await mixDub(clips, p.durationSec, dub, (pct) => ctx.progress(10 + pct * 0.4))
  }
  ctx.throwIfCanceled()

  const out = join(p.epDir, 'mix.wav')
  const inputs: string[] = ['-i', dub]
  const filters: string[] = []
  let idx = 1

  // dub voice chain (+ optional reverb), split for sidechain
  filters.push(`[0:a]aformat=channel_layouts=stereo,aresample=44100${p.reverb ? ',aecho=0.8:0.6:40|70:0.25|0.18' : ''},asplit=2[dub][sc]`)
  const mixInputs = ['[dub]']

  // background
  let bgSource: string | null = null
  let bgVol = 1
  if (!p.muteOriginal) {
    if (p.instrumental && existsSync(p.instrumental) && !p.keepOriginal) bgSource = p.instrumental
    else {
      bgSource = full
      bgVol = p.keepOriginal ? p.origVolume : Math.max(p.origVolume, 0.25)
    }
  }
  const ratio = Math.max(2, Math.min(20, Math.abs(p.duckLevelDb) / 1.5))
  if (!p.muteOriginal && p.autoSpans) {
    // Auto original: switch between the original sound (gaps) and the instrumental / quiet original (under the dub)
    const on = dubOnExpr(p.autoSpans)
    const inst = p.instrumental && existsSync(p.instrumental) && !p.keepOriginal ? p.instrumental : null
    const under = p.keepOriginal ? p.origVolume : 0
    inputs.push('-i', full)
    const i = idx++
    filters.push(`[${i}:a]aformat=channel_layouts=stereo,aresample=44100,volume='1-${(1 - under).toFixed(3)}*${on}':eval=frame[orig]`)
    mixInputs.push('[orig]')
    if (inst) {
      inputs.push('-i', inst)
      const j = idx++
      filters.push(`[${j}:a]aformat=channel_layouts=stereo,aresample=44100,volume='${on}':eval=frame[inst]`)
      mixInputs.push('[inst]')
    }
    filters.push('[sc]anullsink')
  } else if (bgSource) {
    inputs.push('-i', bgSource)
    const i = idx++
    filters.push(`[${i}:a]aformat=channel_layouts=stereo,aresample=44100,volume=${bgVol}[bg0]`)
    if (p.ducking) {
      filters.push(`[bg0][sc]sidechaincompress=threshold=0.03:ratio=${ratio.toFixed(1)}:attack=15:release=350[bg]`)
    } else {
      filters.push('[bg0]anull[bg]', '[sc]anullsink')
    }
    mixInputs.push('[bg]')
  } else {
    filters.push('[sc]anullsink')
  }

  // sound effects: their own track, not ducked
  if (p.sfx?.length) {
    const placed: Array<{ path: string; start: number; gain: number }> = []
    for (const s of p.sfx) {
      try {
        placed.push({ path: await sfxWav(s.src), start: Math.max(0, s.start), gain: s.volume })
      } catch (e) {
        ctx.log(`Sound effect skipped: ${(e as Error).message}`)
      }
    }
    if (placed.length) {
      const sfxTrack = join(p.epDir, 'sfx.wav')
      await mixDub(placed, p.durationSec, sfxTrack)
      inputs.push('-i', sfxTrack)
      const i = idx++
      filters.push(`[${i}:a]aformat=channel_layouts=stereo,aresample=44100[sfx]`)
      mixInputs.push('[sfx]')
    }
  }

  if (p.bgm && existsSync(p.bgm.path)) {
    if (p.bgm.loop) inputs.push('-stream_loop', '-1')
    inputs.push('-i', p.bgm.path)
    const i = idx++
    filters.push(`[${i}:a]aformat=channel_layouts=stereo,aresample=44100,volume=${p.bgm.volume},atrim=0:${p.durationSec.toFixed(3)}[bgm]`)
    mixInputs.push('[bgm]')
  }

  filters.push(
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0:duration=first,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[out]`
  )

  ctx.progress(55, 'Mixing and ducking')
  // a graph file: one fade term per dub line would overflow the Windows command line on long episodes
  writeFileSync(join(p.epDir, 'mix_graph.txt'), filters.join(';\n'), 'utf8')
  const r = await runFfmpeg(
    ['-y', ...inputs, '-/filter_complex', 'mix_graph.txt', '-map', '[out]', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', out, '-progress', 'pipe:1', '-nostats'],
    { cwd: p.epDir, durationSec: p.durationSec, signal: ctx.signal, onProgress: (pct) => ctx.progress(55 + pct * 0.45, 'Mixing and ducking') }
  )
  if (r.code !== 0) throw ffFail('Mix', r.stderr)
  return { dub, mix: out }
}
