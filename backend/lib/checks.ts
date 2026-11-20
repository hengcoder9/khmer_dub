import { statfs } from 'node:fs/promises'
import { parse } from 'node:path'
import type { CheckDef, CheckResult, CheckStatus } from '../../shared/types'
import { run, runFfmpeg } from './ffmpeg'
import { binPath, pythonPath, userDataDir } from './paths'
import { keyPool } from './keys'
import { edgeSynthesize } from './edgeTts'
import { testKey } from './llm'
import { cudaInfo, engineStatus, hasNvidia } from '../pipeline/pysetup'

type Outcome = { status: CheckStatus; detail: string }

interface Check extends CheckDef {
  run?: () => Promise<Outcome>
}

const GB = 1024 ** 3

async function versionOf(name: 'ffmpeg' | 'ffprobe'): Promise<Outcome> {
  const bin = binPath(name)
  try {
    const r = await run(bin.path, ['-version'], { timeoutMs: 10_000 })
    if (r.code !== 0) return { status: 'fail', detail: `${name} exited with code ${r.code}` }
    const first = r.stdout.split(/\r?\n/)[0].replace(/\s+Copyright.*$/, '')
    return bin.bundled
      ? { status: 'ok', detail: `${first} (bundled)` }
      : { status: 'warn', detail: `${first} (from PATH â€” run "npm run fetch:ffmpeg" to bundle it)` }
  } catch {
    return { status: 'fail', detail: `${name} not found. Run "npm run fetch:ffmpeg".` }
  }
}

let encoderCache: { encoder: string; available: string[] } | null = null

/** Try a tiny real encode with each GPU encoder; the first that works wins. */
export async function detectEncoder(): Promise<{ encoder: string; available: string[] }> {
  if (encoderCache) return encoderCache
  const available: string[] = []
  for (const enc of ['h264_nvenc', 'h264_qsv', 'h264_amf']) {
    try {
      const r = await runFfmpeg(
        ['-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2', '-frames:v', '1', '-c:v', enc, '-f', 'null', '-'],
        { timeoutMs: 15_000 }
      )
      if (r.code === 0) available.push(enc)
    } catch {
      /* ffmpeg missing â€” handled by the ffmpeg check */
    }
  }
  encoderCache = { encoder: available[0] ?? 'libx264', available }
  return encoderCache
}

async function pythonCheck(): Promise<Outcome> {
  const py = pythonPath()
  if (!py) return { status: 'warn', detail: 'AI engine runtime not installed — Settings → Engines → Install' }
  try {
    const r = await run(py, ['--version'], { timeoutMs: 10_000 })
    const ver = (r.stdout || r.stderr).trim()
    return r.code === 0 ? { status: 'ok', detail: `${ver} (${py})` } : { status: 'fail', detail: `Python exited with ${r.code}` }
  } catch (e) {
    return { status: 'fail', detail: (e as Error).message }
  }
}

// engine import status is shared by several checks; compute once per Health run (5 s cache)
let statusCache: { at: number; value: Promise<Record<string, boolean>> } | null = null
const engines = () => {
  if (!statusCache || Date.now() - statusCache.at > 5000) statusCache = { at: Date.now(), value: engineStatus() }
  return statusCache.value
}

const engineCheck = (group: string, name: string) => async (): Promise<Outcome> =>
  (await engines())[group]
    ? { status: 'ok', detail: `${name} installed` }
    : { status: 'warn', detail: `${name} not installed — Settings → Engines` }

async function cudaCheck(): Promise<Outcome> {
  if (!(await hasNvidia())) return { status: 'warn', detail: 'No NVIDIA GPU detected — AI engines run on CPU (slower)' }
  const st = await engines()
  if (!st.torch && !st.whisper) return { status: 'warn', detail: 'NVIDIA GPU found; install PyTorch/Whisper to use it' }
  try {
    const c = await cudaInfo()
    if (c.torch || (c.ctranslate2 ?? 0) > 0) return { status: 'ok', detail: `CUDA ready${c.device ? ` — ${c.device}` : ''}` }
    return { status: 'warn', detail: 'NVIDIA GPU found but CUDA is not usable by the engines (check driver)' }
  } catch (e) {
    return { status: 'warn', detail: `Could not query CUDA: ${(e as Error).message}` }
  }
}

async function apiKeysCheck(): Promise<Outcome> {
  const all = [...keyPool.all('gemini'), ...keyPool.all('openrouter'), ...keyPool.all('claude')]
  if (!all.length) return { status: 'warn', detail: 'No API keys — add Gemini/OpenRouter/Claude keys for cloud features' }
  const res = await Promise.all(all.map((k) => testKey(k.provider, k.key)))
  const ok = res.filter((r) => r.ok).length
  if (ok === all.length) return { status: 'ok', detail: `${ok}/${all.length} keys valid` }
  return { status: ok ? 'warn' : 'fail', detail: `${ok}/${all.length} keys valid — ${res.find((r) => !r.ok)?.detail ?? ''}` }
}

async function diskCheck(): Promise<Outcome> {
  let s
  try {
    s = await statfs(userDataDir)
  } catch {
    s = await statfs(parse(userDataDir).root)
  }
  const free = s.bavail * s.bsize
  const detail = `${(free / GB).toFixed(1)} GB free`
  if (free < 2 * GB) return { status: 'fail', detail: `${detail} â€” need at least 2 GB` }
  if (free < 10 * GB) return { status: 'warn', detail: `${detail} â€” 10 GB+ recommended for stems and models` }
  return { status: 'ok', detail }
}

async function internetCheck(): Promise<Outcome> {
  try {
    const r = await fetch('https://www.gstatic.com/generate_204', { signal: AbortSignal.timeout(5000) })
    return r.status < 400
      ? { status: 'ok', detail: 'Online' }
      : { status: 'warn', detail: `Unexpected HTTP ${r.status}` }
  } catch {
    return { status: 'warn', detail: 'Offline â€” cloud engines (Gemini, Edge-TTS) unavailable' }
  }
}

/** Real round-trip: synthesizes one short word with the built-in Node client. */
async function edgeCheck(): Promise<Outcome> {
  const t0 = Date.now()
  try {
    const audio = await edgeSynthesize('OK', { voice: 'en-US-EmmaMultilingualNeural', timeoutMs: 15_000 })
    return { status: 'ok', detail: `Built-in client working (${audio.length} bytes in ${Date.now() - t0} ms)` }
  } catch (e) {
    return { status: 'warn', detail: `Edge-TTS unreachable: ${(e as Error).message}` }
  }
}

const CHECKS: Check[] = [
  { id: 'backend', label: 'Backend server', run: async () => ({ status: 'ok', detail: `Running (pid ${process.pid}, Node ${process.versions.node})` }) },
  { id: 'ffmpeg', label: 'ffmpeg', run: () => versionOf('ffmpeg') },
  { id: 'ffprobe', label: 'ffprobe', run: () => versionOf('ffprobe') },
  {
    id: 'gpuEncoder',
    label: 'GPU video encoder',
    run: async () => {
      const { encoder, available } = await detectEncoder()
      return available.length
        ? { status: 'ok', detail: `Using ${encoder} (available: ${available.join(', ')})` }
        : { status: 'warn', detail: 'No GPU encoder found â€” exports use CPU (libx264)' }
    }
  },
  { id: 'python', label: 'Python', run: pythonCheck },
  { id: 'disk', label: 'Disk space', run: diskCheck },
  { id: 'internet', label: 'Internet', run: internetCheck },
  { id: 'edgeTts', label: 'Edge-TTS', run: edgeCheck },
  { id: 'whisper', label: 'faster-whisper', run: engineCheck('whisper', 'faster-whisper') },
  { id: 'demucs', label: 'Demucs', run: engineCheck('demucs', 'Demucs') },
  { id: 'diarization', label: 'Speaker diarization', run: engineCheck('diarization', 'Speaker detection') },
  { id: 'cloneEngine', label: 'Voice clone engine', run: engineCheck('clone', 'F5-TTS voice cloning') },
  { id: 'cuda', label: 'CUDA', run: cudaCheck },
  { id: 'apiKeys', label: 'API keys valid', run: apiKeysCheck }
]

export const listChecks = (): CheckDef[] => CHECKS.map(({ id, label, phase }) => ({ id, label, phase }))

export async function runCheck(id: string): Promise<CheckResult | null> {
  const c = CHECKS.find((x) => x.id === id)
  if (!c) return null
  const t0 = Date.now()
  if (!c.run) return { id, status: 'later', detail: `Added in Phase ${c.phase}`, ms: 0 }
  try {
    const r = await c.run()
    return { id, ...r, ms: Date.now() - t0 }
  } catch (e) {
    return { id, status: 'fail', detail: (e as Error).message, ms: Date.now() - t0 }
  }
}
