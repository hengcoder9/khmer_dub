import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Aspect, CaptionStyle, Clip, Watermark } from '../../shared/types'
import { serializeSrt, serializeVtt, type Cue } from '../../shared/srt'
import { clipSpeed, layoutClips, mapCuesToOutput, outputDuration, outputSize, transitionDur } from '../../shared/ranges'
import { toAss } from '../../shared/captions'
import { runFfmpeg, probeMedia } from '../lib/ffmpeg'
import { detectEncoder } from '../lib/checks'
import { fontsDir } from '../lib/paths'
import { ffFail } from './extract'
import type { JobCtx } from '../queue'

export interface ExportPayload {
  videoPath: string
  epDir: string
  durationSec: number
  width: number
  height: number
  /** dubbed mix; when missing the original audio is used */
  mixPath?: string
  outDir: string
  baseName: string
  cues: Cue[] // source-time captions
  captions: CaptionStyle
  captionLang: string
  burn: boolean
  edit?: { clips: Clip[]; aspect: Aspect; fitMode: 'crop' | 'pad' | 'blur'; fadeIn: number; fadeOut: number }
  outputs: { mp4: boolean; srt: boolean; vtt: boolean; ass: boolean; dubWav?: string; instrumental?: string }
  encoder?: 'auto' | 'cpu'
  /** source frame rate; transitions need every clip on the same constant rate */
  fps?: number
  /** "Mute Original": without a dub mix the video is exported silent instead of with the original audio */
  muteOriginal?: boolean
  /** short side of the output in px (720/1080/1440/2160); missing = keep the source size */
  resolution?: number
  /** project "Source & licence" note, written as SOURCE.txt next to the export */
  sourceNote?: string
  /** logo image overlaid on the video */
  watermark?: Watermark
}

/** ffmpeg overlay position for a watermark corner (m = margin in px). */
export function wmPosition(pos: Watermark['position'], m: number): string {
  return { tl: `${m}:${m}`, tr: `W-w-${m}:${m}`, bl: `${m}:H-h-${m}`, br: `W-w-${m}:H-h-${m}`, center: '(W-w)/2:(H-h)/2' }[pos]
}

/** atempo only takes 0.5..2 per instance, so chain it for 0.25x / 4x */
function atempo(speed: number): string[] {
  const out: string[] = []
  let s = speed
  while (s > 2.0001) (out.push('atempo=2'), (s /= 2))
  while (s < 0.4999) (out.push('atempo=0.5'), (s /= 0.5))
  if (Math.abs(s - 1) > 0.001) out.push(`atempo=${s.toFixed(4)}`)
  return out
}

/** Per-clip video + audio filters (trim, speed, color, volume) and the joins between clips (concat or xfade). */
export function clipGraph(clips: Clip[], hasAudio: boolean, fps: number): string[] {
  const g: string[] = []
  const n = clips.length
  const placed = layoutClips(clips)
  const anyTransition = clips.some((_, i) => transitionDur(clips, i) > 0)
  const norm = anyTransition ? `,fps=${fps},settb=AVTB,format=yuv420p,setsar=1` : ''
  g.push(`[0:V]split=${n}${clips.map((_, i) => `[sv${i}]`).join('')}`)
  clips.forEach((c, i) => {
    const sp = clipSpeed(c)
    const col = c.color
    const eq = col && (col.brightness !== 0 || col.contrast !== 1 || col.saturation !== 1)
      ? `,eq=brightness=${col.brightness.toFixed(3)}:contrast=${col.contrast.toFixed(3)}:saturation=${col.saturation.toFixed(3)}`
      : ''
    const pts = sp === 1 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${sp.toFixed(4)}`
    g.push(`[sv${i}]trim=start=${c.start.toFixed(3)}:end=${c.end.toFixed(3)},setpts=${pts}${eq}${norm}[v${i}]`)
  })
  if (hasAudio) {
    // pad first: a clip past the end of a short dub mix would otherwise get no audio and drift out of sync
    g.push(`[1:a]apad,asplit=${n}${clips.map((_, i) => `[sa${i}]`).join('')}`)
    clips.forEach((c, i) => {
      const fx = [...atempo(clipSpeed(c)), ...(c.volume !== undefined && c.volume !== 1 ? [`volume=${c.volume.toFixed(3)}`] : [])]
      const fmt = anyTransition ? ',aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo' : ''
      g.push(`[sa${i}]atrim=start=${c.start.toFixed(3)}:end=${c.end.toFixed(3)},asetpts=PTS-STARTPTS${fx.length ? ',' + fx.join(',') : ''}${fmt}[a${i}]`)
    })
  }
  if (!anyTransition) {
    g.push(hasAudio
      ? `${clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[vcat][acat]`
      : `${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[vcat]`)
    return g
  }
  // chain pairwise: xfade/acrossfade where a transition is set, plain concat elsewhere
  let v = 'v0'
  let a = 'a0'
  for (let i = 1; i < n; i++) {
    const d = transitionDur(clips, i - 1)
    const last = i === n - 1
    const vo = last ? 'vcat' : `xv${i}`
    const ao = last ? 'acat' : `xa${i}`
    if (d > 0) {
      g.push(`[${v}][v${i}]xfade=transition=${clips[i - 1].transition!.type}:duration=${d.toFixed(3)}:offset=${placed[i].outStart.toFixed(3)}[${vo}]`)
      if (hasAudio) g.push(`[${a}][a${i}]acrossfade=d=${d.toFixed(3)}[${ao}]`)
    } else if (hasAudio) {
      g.push(`[${v}][${a}][v${i}][a${i}]concat=n=2:v=1:a=1[${vo}][${ao}]`)
    } else {
      g.push(`[${v}][v${i}]concat=n=2:v=1:a=0[${vo}]`)
    }
    v = vo
    a = ao
  }
  return g
}

export { outputSize }
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

async function encoderArgs(pref: 'auto' | 'cpu' = 'auto'): Promise<string[]> {
  const enc = pref === 'cpu' ? 'libx264' : (await detectEncoder()).encoder
  switch (enc) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', '0']
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-global_quality', '22']
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22']
    default:
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20']
  }
}

export async function exportEpisode(p: ExportPayload, ctx: JobCtx): Promise<{ files: string[] }> {
  mkdirSync(p.outDir, { recursive: true })
  const files: string[] = []
  if (p.sourceNote) writeFileSync(join(p.outDir, 'SOURCE.txt'), p.sourceNote, 'utf8')
  const editOn = !!p.edit && (p.edit.clips.length > 0 || p.edit.aspect !== 'source' || p.edit.fadeIn > 0 || p.edit.fadeOut > 0)
  const clips: Clip[] = editOn && p.edit!.clips.length ? p.edit!.clips : [{ id: 'all', start: 0, end: p.durationSec }]
  const outDur = Math.max(0.01, editOn ? outputDuration(clips) : p.durationSec)
  const cues = editOn ? mapCuesToOutput(p.cues, clips) : p.cues
  const size = outputSize(editOn ? p.edit!.aspect : 'source', p.width, p.height, p.resolution)
  // Windows MAX_PATH is 260; leave room for the longest suffix we write ("_instrumental.wav").
  const room = 259 - join(p.outDir, '_instrumental.wav').length
  if (room < 8) throw new Error(`Export folder path is too long for Windows (${p.outDir.length} chars). Choose a shorter folder.`)
  const baseName = (p.baseName.length > room ? p.baseName.slice(0, room) : p.baseName)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '') || 'export'
  const base = join(p.outDir, baseName)

  // text outputs
  if (p.outputs.srt) writeFileSync(`${base}.srt`, serializeSrt(cues), 'utf8'), files.push(`${base}.srt`)
  if (p.outputs.vtt) writeFileSync(`${base}.vtt`, serializeVtt(cues), 'utf8'), files.push(`${base}.vtt`)
  const ass = toAss(cues, p.captions, size.w, size.h, p.captionLang)
  if (p.outputs.ass) writeFileSync(`${base}.ass`, ass, 'utf8'), files.push(`${base}.ass`)
  if (p.outputs.dubWav && existsSync(p.outputs.dubWav)) copyFileSync(p.outputs.dubWav, `${base}_voice.wav`), files.push(`${base}_voice.wav`)
  if (p.outputs.instrumental && existsSync(p.outputs.instrumental)) copyFileSync(p.outputs.instrumental, `${base}_instrumental.wav`), files.push(`${base}_instrumental.wav`)

  if (!p.outputs.mp4) return { files }
  ctx.throwIfCanceled()

  const hasMixAudio = !!(p.mixPath && existsSync(p.mixPath))
  const audioIn = hasMixAudio ? p.mixPath! : p.videoPath
  let hasAudio = hasMixAudio
  if (!hasAudio && !p.muteOriginal) {
    try {
      const info = await probeMedia(audioIn)
      hasAudio = !!info.audio
    } catch {
      hasAudio = false
    }
  }

  const out = `${base}.mp4`
  // a different resolution needs a re-encode (stream copy keeps the source size)
  const resized = size.w !== even(p.width || 1280) || size.h !== even(p.height || 720)
  const wm = p.watermark && existsSync(p.watermark.path) ? p.watermark : null
  let reencode = editOn || p.burn || resized || !!wm

  if (!reencode) {
    ctx.progress(2, 'Muxing (video copy)')
    const muxArgs: string[] = ['-y', '-i', p.videoPath]
    if (hasMixAudio) {
      // apad: a dub mix shorter than the video is padded with silence, so -shortest ends at the VIDEO's end
      // (before, the whole video was cut to the mix length and subtitles no longer matched)
      muxArgs.push('-i', audioIn, '-map', '0:V:0?', '-map', '1:a:0', '-c:v', 'copy', '-af', 'apad', '-c:a', 'aac', '-b:a', '192k')
    } else if (hasAudio) {
      muxArgs.push('-map', '0:V:0?', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k')
    } else {
      muxArgs.push('-map', '0:V:0?', '-c:v', 'copy')
    }
    muxArgs.push('-shortest', '-movflags', '+faststart', out, '-progress', 'pipe:1', '-nostats')

    const r = await runFfmpeg(muxArgs, { durationSec: outDur, signal: ctx.signal, onProgress: (pct) => ctx.progress(pct, 'Muxing') })
    if (r.code === 0 && existsSync(out)) {
      files.unshift(out)
      return { files }
    }
    // If copy muxing failed (e.g. video codec cannot be copied into MP4 container or timestamps mismatch), fall back to re-encode
    ctx.log(`Fast copy muxing not supported for this source, falling back to full re-encode: ${r.stderr.slice(-200)}`)
    reencode = true
  }

  // work dir with ASCII-only names: libass filter args can't safely carry Unicode/colon paths on Windows
  const work = join(p.epDir, 'render_tmp')
  try { rmSync(work, { recursive: true, force: true }) } catch {}
  mkdirSync(join(work, 'fonts'), { recursive: true })
  if (existsSync(fontsDir)) for (const f of readdirSync(fontsDir)) if (/\.(ttf|otf)$/i.test(f)) copyFileSync(join(fontsDir, f), join(work, 'fonts', f))
  writeFileSync(join(work, 'subs.ass'), ass, 'utf8')

  const g: string[] = []
  const n = clips.length
  if (editOn && n > 0) {
    g.push(...clipGraph(clips, hasAudio, p.fps && p.fps > 0 ? p.fps : 30))
    if (!hasAudio) g.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${outDur.toFixed(3)}[acat]`)
  } else {
    g.push('[0:V]null[vcat]')
    if (hasAudio) {
      g.push('[1:a]apad[acat]') // padded; output length is fixed with -t below
    } else {
      g.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${outDur.toFixed(3)}[acat]`)
    }
  }

  const { w, h } = size
  const mode = editOn ? p.edit!.fitMode : 'crop'
  const reframe = editOn && p.edit!.aspect !== 'source'
  if (reframe && mode === 'blur') {
    g.push('[vcat]split=2[bgs][fgs]')
    g.push(`[bgs]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:2[bgb]`)
    g.push(`[fgs]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgb]`)
    g.push('[bgb][fgb]overlay=(W-w)/2:(H-h)/2[vr]')
  } else if (reframe && mode === 'pad') {
    g.push(`[vcat]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black[vr]`)
  } else if (reframe) {
    g.push(`[vcat]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[vr]`)
  } else {
    g.push(`[vcat]scale=${w}:${h}:flags=lanczos[vr]`)
  }

  const vf: string[] = ['setsar=1']
  const af: string[] = []
  const fi = editOn ? p.edit!.fadeIn : 0
  const fo = editOn ? p.edit!.fadeOut : 0
  if (fi > 0) vf.push(`fade=t=in:st=0:d=${fi}`), af.push(`afade=t=in:st=0:d=${fi}`)
  if (fo > 0) vf.push(`fade=t=out:st=${Math.max(0, outDur - fo).toFixed(3)}:d=${fo}`), af.push(`afade=t=out:st=${Math.max(0, outDur - fo).toFixed(3)}:d=${fo}`)
  if (p.burn) vf.push('subtitles=subs.ass:fontsdir=fonts')
  vf.push('format=yuv420p')
  let vIn = 'vr'
  if (wm) {
    // logo: scaled to a share of the frame width, faded to its opacity, kept on screen for the whole video
    const wi = hasAudio ? 2 : 1
    const m = Math.round(Math.min(w, h) * Math.max(0, wm.margin))
    g.push(`[${wi}:v]format=rgba,scale=${even(w * Math.min(0.9, Math.max(0.02, wm.size)))}:-1,colorchannelmixer=aa=${Math.min(1, Math.max(0, wm.opacity)).toFixed(3)}[wm]`)
    g.push(`[vr][wm]overlay=${wmPosition(wm.position, m)}:format=auto[vw]`)
    vIn = 'vw'
  }
  g.push(`[${vIn}]${vf.join(',')}[vout]`)
  g.push(`[acat]${af.length ? af.join(',') : 'anull'}[aout]`)
  writeFileSync(join(work, 'graph.txt'), g.join(';\n'), 'utf8')

  const enc = await encoderArgs(p.encoder)
  ctx.progress(1, `Rendering ${n} clip${n === 1 ? '' : 's'} (${enc[1]})`)
  const inArgs = ['-y', '-i', p.videoPath]
  if (hasAudio) inArgs.push('-i', audioIn)
  if (wm) inArgs.push('-i', wm.path)
  const build = (e: string[]) => [
    ...inArgs,
    '-/filter_complex', 'graph.txt',
    '-map', '[vout]', '-map', '[aout]',
    ...e,
    '-c:a', 'aac', '-b:a', '192k',
    // the output is exactly as long as the (edited) video, whatever the audio length
    '-t', outDur.toFixed(3),
    '-movflags', '+faststart',
    out,
    '-progress', 'pipe:1', '-nostats'
  ]

  let r = await runFfmpeg(build(enc), { cwd: work, durationSec: outDur, signal: ctx.signal, onProgress: (pct) => ctx.progress(pct, 'Rendering') })
  if (r.code !== 0 && enc[1] !== 'libx264' && !ctx.signal.aborted) {
    ctx.log(`GPU encode failed, retrying with libx264: ${r.stderr.slice(-300)}`)
    r = await runFfmpeg(build(await encoderArgs('cpu')), {
      cwd: work, durationSec: outDur, signal: ctx.signal, onProgress: (pct) => ctx.progress(pct, 'Rendering (CPU)')
    })
  }
  try { rmSync(work, { recursive: true, force: true }) } catch {}
  if (r.code !== 0) throw ffFail('Export', r.stderr)
  files.unshift(out)
  return { files }
}
