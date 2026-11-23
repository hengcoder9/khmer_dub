import type { FastifyInstance } from 'fastify'
import { totalmem, freemem, cpus } from 'node:os'
import { statfs } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { parse } from 'node:path'
import type { GpuStats, SystemStats } from '../../shared/types'
import { listChecks, runCheck } from '../lib/checks'
import { userDataDir } from '../lib/paths'
import { listJobs } from '../queue'
import { stopAllWorkers } from '../lib/python'

// CPU load = busy share of the time elapsed since the previous sample
let lastCpu = cpuTimes()
function cpuTimes() {
  let idle = 0
  let total = 0
  for (const c of cpus()) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}
function cpuLoad(): number {
  const now = cpuTimes()
  const dt = now.total - lastCpu.total
  const di = now.idle - lastCpu.idle
  lastCpu = now
  return dt > 0 ? Math.max(0, Math.min(100, 100 * (1 - di / dt))) : 0
}

// nvidia-smi is slow-ish (~100 ms); cache for 2 s and remember when there is no NVIDIA GPU
let gpuCache: { at: number; value: GpuStats | null } | null = null
let noNvidia = false
function queryGpu(): Promise<GpuStats | null> {
  if (noNvidia) return Promise.resolve(null)
  if (gpuCache && Date.now() - gpuCache.at < 2000) return Promise.resolve(gpuCache.value)
  return new Promise((resolve) => {
    let out = ''
    const done = (v: GpuStats | null) => {
      gpuCache = { at: Date.now(), value: v }
      resolve(v)
    }
    try {
      const p = spawn('nvidia-smi', ['--query-gpu=name,memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'], {
        windowsHide: true
      })
      const timer = setTimeout(() => {
        p.kill()
        done(null)
      }, 4000)
      p.stdout.setEncoding('utf8')
      p.stdout.on('data', (d: string) => (out += d))
      p.on('error', () => {
        clearTimeout(timer)
        noNvidia = true
        done(null)
      })
      p.on('close', (code) => {
        clearTimeout(timer)
        const [name, used, total, load] = (out.split(/\r?\n/)[0] ?? '').split(',').map((x) => x.trim())
        if (code !== 0 || !name) return done(null)
        done({ name: name.replace(/^NVIDIA\s+/i, ''), memUsed: Number(used) || 0, memTotal: Number(total) || 0, load: Number(load) || 0 })
      })
    } catch {
      noNvidia = true
      done(null)
    }
  })
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, pid: process.pid }))

  app.get('/health/checks', async () => listChecks())

  app.get<{ Params: { id: string } }>('/health/check/:id', async (req, reply) => {
    const r = await runCheck(req.params.id)
    return r ?? reply.code(404).send({ error: 'unknown check' })
  })

  app.get('/system/stats', async (): Promise<SystemStats> => {
    let disk = { total: 0, free: 0 }
    try {
      const s = await statfs(parse(userDataDir).root)
      disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }
    } catch {
      /* ignore */
    }
    return {
      memTotal: totalmem(),
      memFree: freemem(),
      diskTotal: disk.total,
      diskFree: disk.free,
      cpu: cpuLoad(),
      cores: cpus().length,
      gpu: await queryGpu()
    }
  })

  /** Unload every AI engine (Whisper, Demucs, voice clone) to give the GPU memory back. They restart on the next job. */
  app.post('/system/free-vram', async (_req, reply) => {
    const busy = listJobs().filter((j) => j.status === 'running' || j.status === 'queued')
    if (busy.length) return reply.code(409).send({ error: `${busy.length} job(s) still running — stop them first` })
    stopAllWorkers()
    gpuCache = null
    return { ok: true }
  })
}
