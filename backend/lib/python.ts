// Python worker lifecycle: start lazily, health-check, run jobs with progress polling, kill on exit.

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { modelsDir, pythonPath, workersDir, cacheDir } from './paths'
import type { JobCtx } from '../queue'
import { ENGINE_GROUPS } from '../../shared/engines'

/** Turn "No module named demucs" into an actionable "install engine X" message. */
export function friendlyWorkerError(msg: string): string {
  const m = /No module named '?([\w.]+)'?/.exec(msg)
  if (!m) return msg
  const mod = m[1].split('.')[0]
  const group = ENGINE_GROUPS.find((g) => g.modules.includes(mod))
  const name = group ? `"${group.label}"` : `the engine that provides "${mod}"`
  return `Engine not installed: open Settings → Engines and install ${name}.`
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

/** NVIDIA CUDA DLLs installed via pip (nvidia-cublas-cu12 etc.) must be on PATH for ctranslate2. */
function cudaDllDirs(py: string): string[] {
  const site = join(py, '..', 'Lib', 'site-packages', 'nvidia')
  if (!existsSync(site)) return []
  return readdirSync(site)
    .map((d) => join(site, d, 'bin'))
    .filter((d) => existsSync(d))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class PyWorker {
  private proc: ChildProcess | null = null
  private port = 0
  private token = randomBytes(16).toString('hex')
  private starting: Promise<void> | null = null
  private stderrTail = ''

  constructor(public readonly name: string, private script: string, private extraArgs: string[] = []) {}

  get running() {
    return !!this.proc && this.proc.exitCode === null
  }

  async ensure(): Promise<void> {
    if (this.running && !this.starting) return
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => (this.starting = null))
    return this.starting
  }

  private async start(): Promise<void> {
    const py = pythonPath()
    if (!py) throw new Error('Python engine is not installed. Open Settings → Engines and click "Install".')
    this.port = await freePort()
    this.stderrTail = ''
    const env = {
      ...process.env,
      KD_TOKEN: this.token,
      KD_PARENT_PID: String(process.pid),
      KD_MODELS: modelsDir,
      KD_CACHE: cacheDir,
      HF_HOME: join(modelsDir, 'hf'),
      // hf_xet downloads stall indefinitely on some networks; plain HTTPS is slower but always progresses
      HF_HUB_DISABLE_XET: '1',
      TORCH_HOME: join(modelsDir, 'torch'),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PATH: [...cudaDllDirs(py), process.env.PATH ?? ''].join(';')
    }
    const proc = spawn(py, [join(workersDir, this.script), '--port', String(this.port), ...this.extraArgs], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.proc = proc
    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
    proc.stdout?.on('data', (d: string) => process.stdout.write(`[${this.name}] ${d}`))
    proc.stderr?.on('data', (d: string) => {
      this.stderrTail = (this.stderrTail + d).slice(-4000)
      process.stderr.write(`[${this.name}] ${d}`)
    })
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null
    })

    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`${this.name} failed to start: ${this.lastError()}`)
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/health`, {
          headers: { 'x-kd-token': this.token },
          signal: AbortSignal.timeout(2000)
        })
        if (r.ok) return
      } catch {
        /* not up yet */
      }
      await sleep(400)
    }
    this.stop()
    throw new Error(`${this.name} did not start within 90 s: ${this.lastError()}`)
  }

  private lastError(): string {
    const lines = this.stderrTail.trim().split(/\r?\n/)
    return lines.slice(-3).join(' | ') || 'no output'
  }

  async call<T>(path: string, body?: unknown, timeoutMs = 600_000): Promise<T> {
    await this.ensure()
    const res = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-kd-token': this.token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const txt = await res.text()
    let j: any
    try {
      j = JSON.parse(txt)
    } catch {
      j = { detail: txt }
    }
    if (!res.ok) throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j))
    return j as T
  }

  /** Start a long-running worker job and poll it; a worker that dies mid-job is restarted and the job retried once. */
  async job<T>(kind: string, payload: unknown, ctx?: JobCtx, progressSpan: [number, number] = [0, 100]): Promise<T> {
    try {
      return await this.jobOnce<T>(kind, payload, ctx, progressSpan)
    } catch (e) {
      const msg = (e as Error).message
      if (ctx?.signal.aborted || (e as Error).name === 'AbortError' || !/stopped unexpectedly|fetch failed|ECONNRESET|ECONNREFUSED/i.test(msg)) throw e
      ctx?.log(`${this.name} crashed during ${kind} (${msg.slice(0, 160)}) — restarting it and retrying once`)
      this.stop()
      return this.jobOnce<T>(kind, payload, ctx, progressSpan)
    }
  }

  private async jobOnce<T>(kind: string, payload: unknown, ctx?: JobCtx, progressSpan: [number, number] = [0, 100]): Promise<T> {
    const { id } = await this.call<{ id: string }>(`/jobs/${kind}`, payload)
    const [a, b] = progressSpan
    let canceled = false
    const onAbort = () => {
      canceled = true
      this.call(`/jobs/${id}/cancel`, {}).catch(() => {})
    }
    ctx?.signal.addEventListener('abort', onAbort)
    try {
      for (;;) {
        await sleep(500)
        if (!this.running) throw new Error(`${this.name} stopped unexpectedly: ${this.lastError()}`)
        const j = await this.call<{ status: string; progress: number; message?: string; result?: T; error?: string }>(`/jobs/${id}`)
        ctx?.progress(a + ((b - a) * (j.progress ?? 0)) / 100, j.message)
        if (j.status === 'done') return j.result as T
        if (j.status === 'error') throw new Error(friendlyWorkerError(j.error ?? 'Worker job failed'))
        if (j.status === 'canceled' || canceled) throw Object.assign(new Error('Canceled'), { name: 'AbortError' })
      }
    } finally {
      ctx?.signal.removeEventListener('abort', onAbort)
    }
  }

  stop(): void {
    if (this.proc && this.proc.exitCode === null) {
      // taskkill /T also ends child processes (e.g. demucs subprocess)
      if (process.platform === 'win32' && this.proc.pid) {
        spawn('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {})
      } else this.proc.kill()
    }
    this.proc = null
  }
}

export const aiWorker = new PyWorker('ai-worker', 'ai_worker.py')
/**
 * PyTorch jobs (speaker detection, vocal separation) get their own process: once Whisper (CTranslate2) has loaded its
 * cuDNN, torch dies loading another one ("Could not load symbol cudnnGetLibConfig") and took every job with it.
 */
export const torchWorker = new PyWorker('torch-worker', 'ai_worker.py')

/** Voice-clone workers ("lanes"), one process per lane. */
let cloneLanes: PyWorker[] = []
let laneCursor = 0
export function setCloneLanes(n: number, ckpt?: { model?: string; ckptFile?: string; vocabFile?: string }) {
  const args = ['--model', ckpt?.model || 'F5TTS_v1_Base']
  if (ckpt?.ckptFile) args.push('--ckpt', ckpt.ckptFile)
  if (ckpt?.vocabFile) args.push('--vocab', ckpt.vocabFile)
  cloneLanes.forEach((w) => w.stop())
  cloneLanes = Array.from({ length: Math.max(1, Math.min(4, n)) }, (_, i) => new PyWorker(`clone-${i + 1}`, 'clone_worker.py', args))
}
setCloneLanes(1)
export const nextCloneLane = () => cloneLanes[laneCursor++ % cloneLanes.length]
export const cloneLaneCount = () => cloneLanes.length

export function stopAllWorkers() {
  aiWorker.stop()
  torchWorker.stop()
  cloneLanes.forEach((w) => w.stop())
}
