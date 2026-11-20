// In-process job queue with progress/cancel, broadcast over WebSocket.

import PQueue from 'p-queue'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JobInfo } from '../shared/types'
import { emit } from './lib/events'
import { logsDir } from './lib/paths'

export interface JobCtx {
  id: string
  signal: AbortSignal
  progress(pct: number, message?: string): void
  log(message: string): void
  throwIfCanceled(): void
}

export type Lane = 'cpu' | 'gpu' | 'net'

interface JobDef<P = any> {
  lane: Lane
  label: (p: P) => string
  run: (payload: P, ctx: JobCtx) => Promise<unknown>
}

const registry = new Map<string, JobDef>()
const jobs = new Map<string, JobInfo>()
const controllers = new Map<string, AbortController>()

export const queues: Record<Lane, PQueue> = {
  cpu: new PQueue({ concurrency: 2 }),
  gpu: new PQueue({ concurrency: 1 }),
  net: new PQueue({ concurrency: 4 })
}

export function setGpuLanes(n: number) {
  queues.gpu.concurrency = Math.max(1, Math.min(8, Math.round(n)))
}

export function registerJob<P>(type: string, def: JobDef<P>) {
  registry.set(type, def as JobDef)
}

const LOG = join(logsDir, 'jobs.log')
export const logLine = (line: string) =>
  appendFile(LOG, `${new Date().toISOString()} ${line}\n`, 'utf8').catch(() => {})

let seq = 0
const lastEmit = new Map<string, number>()

function publish(job: JobInfo, force = false) {
  const t = Date.now()
  if (!force && t - (lastEmit.get(job.id) ?? 0) < 200) return
  lastEmit.set(job.id, t)
  emit({ type: 'job', job: { ...job } })
}

export class CanceledError extends Error {
  constructor() {
    super('Canceled')
  }
}

export function createJob(type: string, payload: unknown, episodeId?: string): JobInfo {
  const def = registry.get(type)
  if (!def) throw new Error(`Unknown job type: ${type}`)
  const id = `j${Date.now().toString(36)}${(seq++).toString(36)}`
  const job: JobInfo = { id, type, label: def.label(payload), episodeId, status: 'queued', progress: 0, createdAt: Date.now() }
  jobs.set(id, job)
  const ac = new AbortController()
  controllers.set(id, ac)
  publish(job, true)

  const ctx: JobCtx = {
    id,
    signal: ac.signal,
    progress(pct, message) {
      job.progress = Math.max(0, Math.min(100, Math.round(pct * 10) / 10))
      if (message !== undefined) job.message = message
      publish(job)
    },
    log(message) {
      logLine(`[${id} ${type}] ${message}`)
    },
    throwIfCanceled() {
      if (ac.signal.aborted) throw new CanceledError()
    }
  }

  queues[def.lane]
    .add(async () => {
      if (ac.signal.aborted) return
      job.status = 'running'
      publish(job, true)
      logLine(`[${id} ${type}] start: ${job.label}`)
      try {
        job.result = await def.run(payload, ctx)
        if (ac.signal.aborted) throw new CanceledError()
        job.status = 'done'
        job.progress = 100
      } catch (e) {
        const err = e as Error
        if (ac.signal.aborted || err instanceof CanceledError || err.name === 'AbortError') {
          job.status = 'canceled'
        } else {
          job.status = 'error'
          job.error = err.message
          logLine(`[${id} ${type}] error: ${err.stack ?? err.message}`)
        }
      } finally {
        job.finishedAt = Date.now()
        controllers.delete(id)
        logLine(`[${id} ${type}] ${job.status}`)
        publish(job, true)
        pruneOld()
      }
    })
    .catch(() => {})
  return job
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id)
  const ac = controllers.get(id)
  if (!job || !ac) return false
  ac.abort()
  if (job.status === 'queued') {
    job.status = 'canceled'
    job.finishedAt = Date.now()
    publish(job, true)
  }
  return true
}

export const getJob = (id: string) => jobs.get(id)
export const listJobs = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)

function pruneOld() {
  const done = listJobs().filter((j) => j.finishedAt)
  for (const j of done.slice(100)) {
    jobs.delete(j.id)
    lastEmit.delete(j.id)
  }
}
