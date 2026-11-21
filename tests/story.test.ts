import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { narrationCues, sceneCount, sceneSeconds, storySystemPrompt, validateStory } from '../shared/story'
import { DEFAULT_CAPTIONS } from '../shared/captions'

// voice → a 2 s tone (no network); Omni → a generated clip (no cost)
vi.mock('../backend/pipeline/tts', () => ({
  previewVoice: async (p: { outDir: string }) => {
    const { runFfmpeg } = await import('../backend/lib/ffmpeg')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(p.outDir, { recursive: true })
    const out = join(p.outDir, 'v.wav')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=24000', '-t', '2', out])
    return out
  }
}))
const omniPrompts: string[] = []
vi.mock('../backend/pipeline/genvideo', () => ({
  genVideo: async (p: { prompt: string; outDir: string; name: string; seconds: number }) => {
    omniPrompts.push(p.prompt)
    const { runFfmpeg } = await import('../backend/lib/ffmpeg')
    const out = join(p.outDir, `${p.name}.mp4`)
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24', '-t', String(p.seconds), '-pix_fmt', 'yuv420p', out])
    return { path: out, model: 'fake' }
  }
}))
const { renderStory } = await import('../backend/pipeline/story')
const { runFfmpeg, probeMedia } = await import('../backend/lib/ffmpeg')

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }
const plan = validateStory({
  title: 'អង្គរវត្ត',
  description: 'd',
  hashtags: ['angkor', '#Cambodia', 'angkor'],
  scenes: [
    { narration: 'តើអ្នកដឹងទេ? អង្គរវត្តគឺជាប្រាសាទធំបំផុត។', title: 'អង្គរវត្ត', colors: ['#F59E0B', 'bad'], shot: 'Angkor Wat at sunrise' },
    { narration: 'វាត្រូវបានសាងសង់ក្នុងសតវត្សទីដប់ពីរ។', title: 'សតវត្សទី ១២', colors: [], shot: 'stone carvings close-up' }
  ]
})

describe('Claude Video plan', () => {
  it('cleans the AI plan', () => {
    expect(plan.hashtags).toEqual(['#angkor', '#Cambodia'])
    expect(plan.scenes[0].colors).toEqual(['#F59E0B', '#F59E0B'])
    expect(plan.scenes[1].colors).toEqual(['#1E3A8A', '#7C3AED'])
    expect(() => validateStory({ scenes: [{ narration: '' }] })).toThrow(/did not write any scenes/)
  })
  it('asks for the right number of scenes and Khmer narration size', () => {
    expect(sceneCount(45)).toBe(6)
    expect(sceneCount(10)).toBe(3)
    expect(sceneCount(200)).toBe(12)
    const sys = storySystemPrompt('km', 'story', 45)
    expect(sys).toMatch(/exactly 6 scenes/)
    expect(sys).toMatch(/about 120 Khmer characters/) // 45 s / 6 scenes ≈ 8 s × 15 chars/s
    expect(sceneSeconds(1)).toBe(2.5)
    expect(sceneSeconds(4.2)).toBe(5)
  })
  it('splits narration into captions between words, never inside a Khmer word', () => {
    const cues = narrationCues('អង្គរវត្តគឺជាប្រាសាទសាសនាធំបំផុតនៅលើពិភពលោក។', 0, 6, 20)
    expect(cues.length).toBeGreaterThan(1)
    expect(cues.map((c) => c.text).join('')).toBe('អង្គរវត្តគឺជាប្រាសាទសាសនាធំបំផុតនៅលើពិភពលោក។')
    expect(cues.some((c) => c.text.endsWith('ពិភពលោ'))).toBe(false)
    expect(cues[0].start).toBe(0)
    expect(cues.at(-1)!.end).toBeCloseTo(6, 1)
  })
})

describe('Claude Video render', () => {
  const run = async (background: 'colors' | 'media' | 'omni', media?: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), `kd-story-${background}-`))
    const r = await renderStory(
      {
        plan, aspect: '9:16', background, media, voiceId: 'default:female', defaultMale: 'm', defaultFemale: 'f',
        captions: DEFAULT_CAPTIONS, lang: 'km', outDir: join(dir, 'out'), name: 'Claude អង្គរ'
      },
      ctx
    )
    return { dir, r }
  }

  it('renders colour scenes with voice, titles, captions, srt and upload text', async () => {
    const { dir, r } = await run('colors')
    try {
      expect(r.files.map((f) => basename(f))).toEqual(['Claude អង្គរ.mp4', 'Claude អង្គរ.srt', 'Claude អង្គរ.txt'])
      const info = await probeMedia(r.files[0])
      expect(info.video).toMatchObject({ width: 720, height: 1280 })
      expect(info.audio).toBeTruthy()
      expect(info.durationSec).toBeCloseTo(2 * sceneSeconds(2), 0) // two 2 s voices → two 2.8 s scenes
      expect(readFileSync(r.files[1], 'utf8')).toContain('អង្គរវត្ត')
      expect(readFileSync(r.files[2], 'utf8')).toContain('#angkor #Cambodia')
      expect(existsSync(join(dir, 'out')) && !require('node:fs').readdirSync(join(dir, 'out')).some((f: string) => f.startsWith('_story_tmp'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('uses your photo as a slow-zoom background', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'kd-photo-'))
    const photo = join(tmp, 'p.png')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=800x600', '-frames:v', '1', photo])
    const { dir, r } = await run('media', [photo])
    try {
      expect((await probeMedia(r.files[0])).video).toMatchObject({ width: 720, height: 1280 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(tmp, { recursive: true, force: true })
    }
  }, 120_000)

  it('lets Omni film each scene from Claude’s camera prompt', async () => {
    omniPrompts.length = 0
    const { dir, r } = await run('omni')
    try {
      expect(omniPrompts).toEqual(['Angkor Wat at sunrise', 'stone carvings close-up'])
      expect((await probeMedia(r.files[0])).durationSec).toBeGreaterThan(5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
