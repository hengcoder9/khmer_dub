import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { SFX_LIBRARY, VOICE_FX_IDS } from '../shared/fx'
import { fxClip, sfxWav } from '../backend/lib/fxrender'
import { runFfmpeg } from '../backend/lib/ffmpeg'
import { binPath } from '../backend/lib/paths'
import { mix } from '../backend/pipeline/mix'

const probe = (f: string) => spawnSync(binPath('ffprobe').path, ['-v', 'error', '-show_entries', 'format=duration:stream=sample_rate,channels', '-of', 'json', f]).stdout.toString()
/** loudest level (dBFS) in [from, to] */
function peakDb(f: string, from = 0, to = 999): number {
  const r = spawnSync(binPath('ffmpeg').path, ['-hide_banner', '-ss', String(from), '-t', String(to - from), '-i', f, '-af', 'astats=metadata=0', '-f', 'null', '-'])
  const m = r.stderr.toString().match(/Peak level dB:\s*(-?[\d.]+|-inf)/g)
  const vals = (m ?? []).map((x) => Number(x.split(':')[1].trim())).filter(Number.isFinite)
  return vals.length ? Math.max(...vals) : -Infinity
}
const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

describe('sound effects and voice effects', () => {
  it('every built-in sound renders: mono 44.1 kHz, the right length, not silent', async () => {
    for (const s of SFX_LIBRARY) {
      const f = await sfxWav(`builtin:${s.id}`)
      const j = JSON.parse(probe(f))
      expect(j.streams[0].sample_rate, s.id).toBe('44100')
      expect(j.streams[0].channels, s.id).toBe(1)
      expect(Math.abs(Number(j.format.duration) - s.dur), s.id).toBeLessThan(0.05)
      expect(peakDb(f), s.id).toBeGreaterThan(-20)
    }
  }, 120_000)

  it('every voice effect renders a voice clip (mixable format, still audible)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-fx-'))
    try {
      const voice = join(dir, 'v.wav')
      // a "voice": a 2 s tone sweep with some noise, 44.1 kHz mono like a TTS clip
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*(180+60*sin(2*PI*3*t))*t)+0.05*(random(0)*2-1)':s=44100:d=2", '-ac', '1', '-c:a', 'pcm_s16le', voice])
      for (const fx of VOICE_FX_IDS) {
        const f = await fxClip(voice, fx)
        const j = JSON.parse(probe(f))
        expect(j.streams[0].sample_rate, fx).toBe('44100')
        expect(j.streams[0].channels, fx).toBe(1)
        expect(Number(j.format.duration), fx).toBeGreaterThan(1.5)
        expect(peakDb(f), fx).toBeGreaterThan(-30)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('a placed sound is heard in the mix at its time, a voice effect is applied', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-fxmix-'))
    try {
      const vid = join(dir, 'v.mp4')
      // a silent 8 s video
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:size=160x90:rate=10', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', vid])
      const line = join(dir, 'line.wav')
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*220*t)':s=44100:d=1", '-ac', '1', '-c:a', 'pcm_s16le', line])
      const r = await mix(
        {
          videoPath: vid, epDir: dir, durationSec: 8,
          clips: [{ path: line, start: 1, gain: 1, fx: 'echo' }],
          sfx: [{ src: 'builtin:boom', start: 5, volume: 1 }],
          ducking: false, duckLevelDb: -10, keepOriginal: false, origVolume: 0, muteOriginal: true, reverb: false
        },
        ctx
      )
      // quiet before the line, the line at 1 s, its echo tail after it ends (2.0–2.6 s), silence, the boom at 5 s
      expect(peakDb(r.mix, 0, 0.9)).toBeLessThan(-40)
      expect(peakDb(r.mix, 1.1, 1.9)).toBeGreaterThan(-25)
      expect(peakDb(r.mix, 2.05, 2.6)).toBeGreaterThan(-45) // echo tail
      expect(peakDb(r.mix, 3.3, 4.9)).toBeLessThan(-40)
      expect(peakDb(r.mix, 5, 5.6)).toBeGreaterThan(-25) // boom
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
