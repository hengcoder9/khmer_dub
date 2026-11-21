// "Claude Video": Claude writes the scenes (planStory); this job renders them into an MP4 (renderStory).
// Each scene: narration voice (Edge / clone) → scene length → background (moving colours, the user's photo/clip, or a
// Gemini Omni shot) → titles + captions burned with libass (Khmer shaped) → optional music under the voice.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { CaptionStyle } from '../../shared/types'
import type { Provider } from '../lib/keys'
import type { JobCtx } from '../queue'
import { llmJson } from '../lib/llm'
import { probeMedia, runFfmpeg } from '../lib/ffmpeg'
import { fontsDir } from '../lib/paths'
import { toAss, withTitles } from '../../shared/captions'
import { serializeSrt } from '../../shared/srt'
import { narrationCues, sceneSeconds, storySystemPrompt, validateStory, type StoryBackground, type StoryPlan, type StoryStyle } from '../../shared/story'
import { ffFail } from './extract'
import { previewVoice } from './tts'
import { genVideo } from './genvideo'
import { metaText } from './aicreate'

export async function planStory(req: { provider: Provider; model: string; topic: string; lang: string; style: StoryStyle; seconds: number }): Promise<StoryPlan> {
  if (!req.topic.trim()) throw new Error('Write what the video is about first')
  const raw = await llmJson<unknown>({
    provider: req.provider,
    model: req.model,
    system: storySystemPrompt(req.lang, req.style, req.seconds),
    parts: [{ text: `Topic / idea:\n${req.topic.trim()}` }],
    temperature: 0.8
  })
  return validateStory(raw)
}

export interface StoryPayload {
  plan: StoryPlan
  aspect: '9:16' | '16:9'
  background: StoryBackground
  /** user photos / clips, used in turn for the scenes (background = media) */
  media?: string[]
  musicPath?: string
  voiceId: string
  defaultMale: string
  defaultFemale: string
  captions: CaptionStyle
  lang: string
  outDir: string
  name: string
}

const SIZE = { '9:16': { w: 720, h: 1280 }, '16:9': { w: 1280, h: 720 } }
const FPS = 30
const IMG = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])
const hex = (c: string) => `0x${c.replace('#', '')}`

async function sceneVisual(
  i: number,
  d: number,
  p: StoryPayload,
  work: string,
  ctx: JobCtx
): Promise<string> {
  const { w, h } = SIZE[p.aspect]
  const out = join(work, `v${String(i).padStart(2, '0')}.mp4`)
  const fade = `fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(0, d - 0.3).toFixed(2)}:d=0.3`
  const enc = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-t', d.toFixed(2), out]
  const scene = p.plan.scenes[i]
  let src: string | undefined
  if (p.background === 'omni') {
    ctx.log(`Scene ${i + 1}: Omni is filming "${scene.shot.slice(0, 80)}"`)
    const clip = await genVideo(
      { prompt: scene.shot || scene.title, aspect: p.aspect, resolution: '720p', seconds: Math.max(3, Math.min(15, Math.ceil(d))), outDir: work, name: `omni${i}` },
      { ...ctx, progress: () => {} }
    )
    src = clip.path
  } else if (p.background === 'media' && p.media?.length) {
    src = p.media[i % p.media.length]
  }
  let args: string[]
  if (src && IMG.has(extname(src).toLowerCase())) {
    // photo: slow zoom (Ken Burns)
    const frames = Math.ceil(d * FPS)
    args = ['-y', '-i', src, '-vf', `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='min(zoom+0.0009,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${FPS},${fade}`, ...enc]
  } else if (src) {
    // clip (user's or Omni's): loop if short, fill the frame
    args = ['-y', '-stream_loop', '-1', '-i', src, '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${FPS},setsar=1,${fade}`, ...enc]
  } else {
    // moving two-colour gradient
    const [c0, c1] = scene.colors
    args = ['-y', '-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${hex(c0)}:c1=${hex(c1)}:x0=0:y0=0:x1=${w}:y1=${h}:speed=0.012:rate=${FPS}:duration=${d.toFixed(2)}`, '-vf', `vignette=PI/5,${fade}`, ...enc]
  }
  const r = await runFfmpeg(args, { signal: ctx.signal })
  if (r.code !== 0) throw ffFail(`Scene ${i + 1} picture`, r.stderr)
  return out
}

export async function renderStory(p: StoryPayload, ctx: JobCtx): Promise<{ files: string[] }> {
  const scenes = p.plan.scenes
  if (!scenes.length) throw new Error('No scenes to render')
  const { w, h } = SIZE[p.aspect]
  mkdirSync(p.outDir, { recursive: true })
  const work = join(p.outDir, `_story_tmp_${Date.now().toString(36)}`)
  mkdirSync(join(work, 'fonts'), { recursive: true })
  try {
    if (existsSync(fontsDir)) for (const f of readdirSync(fontsDir)) if (/\.(ttf|otf)$/i.test(f)) copyFileSync(join(fontsDir, f), join(work, 'fonts', f))

    // 1) voices → scene lengths → padded scene audio
    const durs: number[] = []
    const audios: string[] = []
    for (const [i, s] of scenes.entries()) {
      ctx.throwIfCanceled()
      ctx.progress((i / scenes.length) * 30, `Voice ${i + 1}/${scenes.length}`)
      const raw = await previewVoice({ voiceId: p.voiceId, text: s.narration, defaultMale: p.defaultMale, defaultFemale: p.defaultFemale, outDir: join(work, `voice${i}`) })
      const sec = (await probeMedia(raw)).durationSec
      const d = sceneSeconds(sec)
      durs.push(d)
      const a = join(work, `a${String(i).padStart(2, '0')}.wav`)
      const r = await runFfmpeg(['-y', '-i', raw, '-af', `aresample=44100,aformat=channel_layouts=stereo,adelay=300|300,apad,atrim=0:${d.toFixed(2)}`, '-c:a', 'pcm_s16le', a], { signal: ctx.signal })
      if (r.code !== 0) throw ffFail(`Scene ${i + 1} voice`, r.stderr)
      audios.push(a)
    }

    // 2) pictures
    const videos: string[] = []
    for (const [i] of scenes.entries()) {
      ctx.throwIfCanceled()
      ctx.progress(30 + (i / scenes.length) * 45, `Scene ${i + 1}/${scenes.length}${p.background === 'omni' ? ' (Omni filming…)' : ''}`)
      videos.push(await sceneVisual(i, durs[i], p, work, ctx))
    }

    // 3) join pictures and voices
    writeFileSync(join(work, 'v.txt'), videos.map((v) => `file '${v.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
    writeFileSync(join(work, 'a.txt'), audios.map((v) => `file '${v.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
    let r = await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'v.txt'), '-c', 'copy', join(work, 'video.mp4')], { signal: ctx.signal })
    if (r.code !== 0) throw ffFail('Joining scenes', r.stderr)
    r = await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'a.txt'), '-c', 'copy', join(work, 'voice.wav')], { signal: ctx.signal })
    if (r.code !== 0) throw ffFail('Joining voices', r.stderr)

    // 4) titles + captions (one ASS for the whole video)
    const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0))
    const total = starts[starts.length - 1] + durs[durs.length - 1]
    // shorter caption lines on a vertical video
    const maxChars = p.aspect === '9:16' ? 28 : 44
    const cues = scenes.flatMap((s, i) => narrationCues(s.narration, starts[i] + 0.3, starts[i] + durs[i] - 0.45, maxChars, p.lang))
    const titles = scenes.map((s, i) => ({ text: s.title, start: starts[i] + 0.05, end: starts[i] + durs[i] - 0.15 }))
    const ass = withTitles(toAss(cues, p.captions, w, h, p.lang), titles, p.captions.font, w, h)
    writeFileSync(join(work, 'story.ass'), ass, 'utf8')

    // 5) final: burn text, mix music under the voice
    ctx.progress(80, 'Rendering the video')
    const safe = (p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'Claude video').replace(/[. ]+$/, '')
    let base = join(p.outDir, safe)
    for (let i = 2; existsSync(`${base}.mp4`); i++) base = join(p.outDir, `${safe} (${i})`)
    const music = p.musicPath && existsSync(p.musicPath)
    const args = ['-y', '-i', 'video.mp4', '-i', 'voice.wav', ...(music ? ['-stream_loop', '-1', '-i', p.musicPath!] : [])]
    const af = music
      ? ['-filter_complex', `[2:a]volume=0.12,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[m];[1:a][m]amix=inputs=2:duration=first:normalize=0[a]`, '-map', '0:v', '-map', '[a]']
      : ['-map', '0:v', '-map', '1:a']
    r = await runFfmpeg(
      [...args, ...af, '-vf', 'subtitles=story.ass:fontsdir=fonts', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(2), '-movflags', '+faststart', `${base}.mp4`, '-progress', 'pipe:1', '-nostats'],
      { cwd: work, signal: ctx.signal, durationSec: total, onProgress: (pct) => ctx.progress(80 + pct * 0.19, 'Rendering the video') }
    )
    if (r.code !== 0) throw ffFail('Rendering', r.stderr)
    writeFileSync(`${base}.srt`, serializeSrt(cues), 'utf8')
    writeFileSync(`${base}.txt`, metaText({ title: p.plan.title, description: p.plan.description, hashtags: p.plan.hashtags }), 'utf8')
    ctx.progress(100, `${Math.round(total)} s video ready`)
    return { files: [`${base}.mp4`, `${base}.srt`, `${base}.txt`] }
  } finally {
    try {
      rmSync(work, { recursive: true, force: true })
    } catch {
      /* in use */
    }
  }
}
