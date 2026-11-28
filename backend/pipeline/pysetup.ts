// Installs the embedded Python 3.10 runtime and optional engine groups into %APPDATA%/<app>/python.
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ENGINE_GROUPS } from '../../shared/engines'
import { pythonEnvDir, pythonPath, workersDir } from '../lib/paths'
import { aiWorker, stopAllWorkers } from '../lib/python'
import type { JobCtx } from '../queue'

const PY_URL = 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip'
const GET_PIP = 'https://bootstrap.pypa.io/get-pip.py'
const TORCH_CUDA = 'https://download.pytorch.org/whl/cu121'
const TORCH_CPU = 'https://download.pytorch.org/whl/cpu'

async function download(url: string, dest: string, ctx: JobCtx, label: string) {
  const res = await fetch(url, { signal: ctx.signal })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  const body = Readable.fromWeb(res.body as never).on('data', (c: Buffer) => {
    got += c.length
    if (total) ctx.progress(Math.min(99, (got / total) * 100), `${label} ${(got / 1048576).toFixed(1)} MB`)
  })
  await pipeline(body, createWriteStream(dest))
}

function runLogged(cmd: string, args: string[], ctx: JobCtx, onLine?: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      signal: ctx.signal,
      env: { ...process.env, PYTHONUTF8: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1' }
    })
    let tail = ''
    const handle = (d: Buffer) => {
      const s = d.toString('utf8')
      tail = (tail + s).slice(-3000)
      for (const line of s.split(/\r?\n/)) if (line.trim()) onLine?.(line.trim())
    }
    child.stdout.on('data', handle)
    child.stderr.on('data', handle)
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${args.slice(0, 4).join(' ')} failed (exit ${code}): ${tail.trim().split(/\r?\n/).slice(-4).join(' | ')}`))
    })
  })
}

export async function hasNvidia(): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn('nvidia-smi', ['-L'], { windowsHide: true })
    let out = ''
    c.stdout.on('data', (d) => (out += d))
    c.on('error', () => resolve(false))
    c.on('close', (code) => resolve(code === 0 && /GPU/.test(out)))
  })
}

async function ensureRuntime(ctx: JobCtx): Promise<string> {
  const existing = pythonPath()
  if (existing) return existing
  mkdirSync(pythonEnvDir, { recursive: true })
  const zip = join(pythonEnvDir, 'python.zip')
  ctx.progress(0, 'Downloading Python 3.10')
  await download(PY_URL, zip, ctx, 'Python 3.10')
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  await runLogged(existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', pythonEnvDir], ctx)
  rmSync(zip, { force: true })
  // enable site-packages in the embedded distribution
  const pth = readdirSync(pythonEnvDir).find((f) => /^python\d+\._pth$/.test(f))
  if (pth) {
    const file = join(pythonEnvDir, pth)
    const txt = readFileSync(file, 'utf8').replace(/^#\s*import site/m, 'import site')
    writeFileSync(file, txt.includes('Lib\\site-packages') ? txt : `${txt.trim()}\nLib\\site-packages\n`)
  }
  const py = join(pythonEnvDir, 'python.exe')
  ctx.progress(0, 'Installing pip')
  const gp = join(pythonEnvDir, 'get-pip.py')
  await download(GET_PIP, gp, ctx, 'get-pip')
  await runLogged(py, [gp, '--no-warn-script-location'], ctx)
  rmSync(gp, { force: true })
  return py
}

function packagesFor(group: string, cuda: boolean): string[][] {
  // each inner array is one pip invocation
  switch (group) {
    case 'core':
      return [['fastapi==0.115.6', 'uvicorn==0.32.1', 'edge-tts>=7.0.0', 'numpy<2', 'soundfile>=0.12', 'requests']]
    case 'whisper':
      return [['faster-whisper>=1.1.0', ...(cuda ? ['nvidia-cublas-cu12', 'nvidia-cudnn-cu12==9.*'] : [])]]
    case 'torch':
      return [['torch==2.5.1', 'torchaudio==2.5.1', '--index-url', cuda ? TORCH_CUDA : TORCH_CPU]]
    case 'demucs':
      return [['demucs==4.0.1']]
    case 'diarization':
      return [['webrtcvad-wheels', 'librosa>=0.10', 'scikit-learn', 'scipy'], ['resemblyzer==0.1.4', '--no-deps']]
    case 'translate':
      return [['ctranslate2>=4.4', 'sentencepiece', 'huggingface_hub']]
    case 'ocr':
      // headless OpenCV (no GUI DLLs); numpy stays < 2 for the other engines
      return [['rapidocr_onnxruntime>=1.3,<2', 'opencv-python-headless<4.11', 'numpy<2']]
    case 'voxcpm':
      // --no-deps: voxcpm also lists gradio, funasr, torchcodec, modelscope and training libs that cloning doesn't import,
      // and torchcodec would pull a newer torch that breaks the other engines. Keep torch / numpy pinned.
      return [
        ['voxcpm==2.0.3', '--no-deps'],
        ['transformers>=4.36.2,<5', 'einops', 'pydantic', 'safetensors', 'tqdm', 'librosa>=0.10', 'huggingface_hub', 'soundfile>=0.12', 'numpy<2', 'torch==2.5.1', 'torchaudio==2.5.1', '--extra-index-url', cuda ? TORCH_CUDA : TORCH_CPU]
      ]
    case 'clone':
      return [['f5-tts']]
    default:
      throw new Error(`Unknown engine group: ${group}`)
  }
}

/** Expand requirements (e.g. demucs → torch → core) in install order. */
export function resolveGroups(groups: string[]): string[] {
  const out: string[] = []
  const visit = (id: string) => {
    if (out.includes(id)) return
    const g = ENGINE_GROUPS.find((x) => x.id === id)
    if (!g) throw new Error(`Unknown engine group: ${id}`)
    for (const r of g.requires ?? []) visit(r)
    out.push(id)
  }
  groups.forEach(visit)
  return out
}

export async function installEngines(p: { groups: string[]; force?: boolean }, ctx: JobCtx): Promise<{ installed: string[] }> {
  const py = await ensureRuntime(ctx)
  const cuda = await hasNvidia()
  const status = p.force ? {} : await engineStatus().catch(() => ({}) as Record<string, boolean>)
  const groups = resolveGroups(p.groups).filter((g) => p.force || !status[g])
  stopAllWorkers() // packages may be replaced underneath a running worker
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const label = ENGINE_GROUPS.find((x) => x.id === g)?.label ?? g
    for (const pkgs of packagesFor(g, cuda)) {
      ctx.throwIfCanceled()
      ctx.progress((i / groups.length) * 100, `Installing ${label}…`)
      await runLogged(py, ['-m', 'pip', 'install', '--no-warn-script-location', ...pkgs], ctx, (line) => {
        if (/^(Collecting|Downloading|Installing|Successfully)/.test(line)) ctx.progress((i / groups.length) * 100, `${label}: ${line.slice(0, 90)}`)
      })
    }
  }
  return { installed: groups }
}

/** Which engine groups import successfully (checked in a short-lived python process, no worker needed). */
export async function engineStatus(): Promise<Record<string, boolean>> {
  const py = pythonPath()
  const result: Record<string, boolean> = Object.fromEntries(ENGINE_GROUPS.map((g) => [g.id, false]))
  if (!py) return result
  const mods = [...new Set(ENGINE_GROUPS.flatMap((g) => g.modules))]
  const code = `import importlib.util, json; print(json.dumps({m: importlib.util.find_spec(m) is not None for m in ${JSON.stringify(mods)}}))`
  const found = await new Promise<Record<string, boolean>>((resolve) => {
    const c = spawn(py, ['-c', code], { windowsHide: true })
    let out = ''
    c.stdout.on('data', (d) => (out += d))
    c.on('error', () => resolve({}))
    c.on('close', () => {
      try {
        resolve(JSON.parse(out.trim().split(/\r?\n/).pop() ?? '{}'))
      } catch {
        resolve({})
      }
    })
  })
  for (const g of ENGINE_GROUPS) result[g.id] = g.modules.every((m) => found[m])
  return result
}

/** Ask the running worker about CUDA (starts it if needed). */
export async function cudaInfo(): Promise<{ torch?: boolean; ctranslate2?: number; device?: string }> {
  if (!existsSync(join(workersDir, 'ai_worker.py'))) return {}
  return aiWorker.call('/cuda', undefined, 60_000)
}
