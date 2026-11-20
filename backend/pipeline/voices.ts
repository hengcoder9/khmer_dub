import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CloneVoice, Gender, Voice } from '../../shared/types'
import { uid } from '../../shared/defaults'
import { cacheDir, pythonPath, voicesDir } from '../lib/paths'
import { aiWorker } from '../lib/python'
import { runFfmpeg } from '../lib/ffmpeg'
import { ffFail } from './extract'

const EDGE_FALLBACK: Array<[string, Gender]> = [
  ['km-KH-PisethNeural', 'male'],
  ['km-KH-SreymomNeural', 'female'],
  ['en-US-GuyNeural', 'male'],
  ['en-US-JennyNeural', 'female'],
  ['th-TH-NiwatNeural', 'male'],
  ['th-TH-PremwadeeNeural', 'female'],
  ['vi-VN-NamMinhNeural', 'male'],
  ['vi-VN-HoaiMyNeural', 'female'],
  ['zh-CN-YunxiNeural', 'male'],
  ['zh-CN-XiaoxiaoNeural', 'female'],
  ['ko-KR-InJoonNeural', 'male'],
  ['ko-KR-SunHiNeural', 'female']
]

const edgeVoice = (short: string, gender: Gender): Voice => ({
  id: `edge:${short}`,
  engine: 'edge',
  name: short.replace(/^[a-z]{2,3}-[A-Z]{2}-/, '').replace(/Neural$/, '') + ` (${short.slice(0, 5)})`,
  gender,
  locale: short.slice(0, 5)
})

const EDGE_CACHE = join(cacheDir, 'edge-voices.json')

export async function edgeVoices(refresh = false): Promise<Voice[]> {
  if (!refresh && existsSync(EDGE_CACHE)) {
    try {
      return JSON.parse(readFileSync(EDGE_CACHE, 'utf8')) as Voice[]
    } catch {
      /* re-fetch */
    }
  }
  if (pythonPath()) {
    try {
      const r = await aiWorker.call<{ voices: Array<{ ShortName: string; Gender: string }> }>('/voices/edge', undefined, 60_000)
      const list = r.voices.map((v) => edgeVoice(v.ShortName, v.Gender?.toLowerCase() === 'female' ? 'female' : 'male'))
      if (list.length) {
        writeFileSync(EDGE_CACHE, JSON.stringify(list))
        return list
      }
    } catch {
      /* fall back */
    }
  }
  return EDGE_FALLBACK.map(([s, g]) => edgeVoice(s, g))
}

export function cloneVoices(): CloneVoice[] {
  if (!existsSync(voicesDir)) return []
  const out: CloneVoice[] = []
  for (const d of readdirSync(voicesDir)) {
    try {
      out.push(JSON.parse(readFileSync(join(voicesDir, d, 'meta.json'), 'utf8')) as CloneVoice)
    } catch {
      /* skip broken */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function allVoices(): Promise<Voice[]> {
  const clones: Voice[] = cloneVoices().map((c) => ({ id: `clone:${c.id}`, engine: 'clone', name: `${c.name} (clone)`, gender: c.gender, locale: '' }))
  return [
    { id: 'default:male', engine: 'edge', name: 'Default Male', gender: 'male', locale: '' },
    { id: 'default:female', engine: 'edge', name: 'Default Female', gender: 'female', locale: '' },
    ...clones,
    ...(await edgeVoices())
  ]
}

/** Store a reference clip (5–15 s) + transcript as a clone voice. */
export async function createCloneVoice(p: { name: string; gender: Gender; refPath: string; refText: string; start?: number; duration?: number }): Promise<CloneVoice> {
  const id = uid('v')
  const dir = join(voicesDir, id)
  mkdirSync(dir, { recursive: true })
  const ref = join(dir, 'ref.wav')
  const r = await runFfmpeg([
    '-y', ...(p.start ? ['-ss', String(p.start)] : []), '-i', p.refPath, '-t', String(Math.min(15, p.duration ?? 15)), '-vn', '-ac', '1', '-ar', '24000',
    '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,loudnorm=I=-18:TP=-2', '-c:a', 'pcm_s16le', ref
  ])
  if (r.code !== 0) {
    rmSync(dir, { recursive: true, force: true })
    throw ffFail('Reference audio conversion', r.stderr)
  }
  const voice: CloneVoice = { id, name: p.name.trim() || 'Voice', gender: p.gender, refAudio: ref, refText: p.refText.trim() }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(voice, null, 2))
  return voice
}

export function deleteCloneVoice(id: string) {
  if (!/^[\w-]+$/.test(id)) throw new Error('bad id')
  rmSync(join(voicesDir, id), { recursive: true, force: true })
}

export const getCloneVoice = (id: string) => cloneVoices().find((v) => v.id === id)
