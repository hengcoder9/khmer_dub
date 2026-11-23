import { create } from 'zustand'
import type { JobInfo, ServerEvent } from '@shared/types'
import { api, backend } from '@/lib/api'
import { hasAccess, useAccount } from './account'
import { useUi } from './ui'

/** AI + export jobs need a signed-in account with an active plan or trial. */
export const PAID_JOBS = new Set(['separate', 'transcribe', 'diarize', 'translate', 'tts', 'export', 'polish', 'genvideo', 'story', 'ocr', 'ocrarea'])

export class AccessError extends Error {}

interface JobsState {
  jobs: Record<string, JobInfo>
  keys: { total: number; ready: number }
  connected: boolean
}

export const useJobs = create<JobsState>()(() => ({ jobs: {}, keys: { total: 0, ready: 0 }, connected: false }))

type Waiter = { resolve: (j: JobInfo) => void }
const waiters = new Map<string, Waiter[]>()

const FINISHED = ['done', 'error', 'canceled']
const rank = (st: JobInfo['status']) => (FINISHED.includes(st) ? 2 : st === 'running' ? 1 : 0)

function onJob(job: JobInfo) {
  // Fast jobs can finish (and their WebSocket "done" arrive) before the POST /jobs reply does.
  // That stale "queued" snapshot must not overwrite the finished job, or its waiter hangs at 0% forever.
  const prev = useJobs.getState().jobs[job.id]
  if (prev && rank(prev.status) > rank(job.status)) return
  useJobs.setState((s) => ({ jobs: { ...s.jobs, [job.id]: job } }))
  if (FINISHED.includes(job.status)) {
    for (const w of waiters.get(job.id) ?? []) w.resolve(job)
    waiters.delete(job.id)
  }
}

// Safety net: if a WebSocket event is ever missed (sleep, dropped socket), poll until every awaited job settles.
let poller: ReturnType<typeof setInterval> | null = null
function ensurePolling() {
  if (poller) return
  poller = setInterval(async () => {
    if (!waiters.size) {
      clearInterval(poller!)
      poller = null
      return
    }
    const list = await api<JobInfo[]>('/jobs').catch(() => [] as JobInfo[])
    list.filter((j) => waiters.has(j.id)).forEach(onJob)
  }, 3000)
}

let ws: WebSocket | null = null
export async function connectEvents() {
  if (ws && ws.readyState <= 1) return
  const b = await backend()
  ws = new WebSocket(`ws://127.0.0.1:${b.port}/ws?token=${b.token}`)
  ws.onopen = async () => {
    useJobs.setState({ connected: true })
    // catch up on anything that finished while disconnected
    const list = await api<JobInfo[]>('/jobs').catch(() => [])
    list.forEach(onJob)
  }
  ws.onmessage = (m) => {
    const ev = JSON.parse(m.data as string) as ServerEvent
    if (ev.type === 'job') onJob(ev.job)
    else if (ev.type === 'keys') useJobs.setState({ keys: { total: ev.total, ready: ev.ready } })
  }
  ws.onclose = () => {
    useJobs.setState({ connected: false })
    setTimeout(() => connectEvents().catch(() => {}), 1500)
  }
}

export class JobError extends Error {
  constructor(public job: JobInfo) {
    super(job.status === 'canceled' ? 'Canceled' : (job.error ?? 'Job failed'))
  }
}

/** Queue a backend job and resolve with its result when it finishes (rejects on error/cancel). */
export async function runJob<T>(type: string, payload: unknown, episodeId?: string): Promise<T> {
  if (PAID_JOBS.has(type) && !hasAccess()) {
    useUi.getState().set({ dialog: 'account' })
    throw new AccessError(
      useAccount.getState().signedIn
        ? 'Your free trial or plan has ended — choose a plan to keep using the AI tools.'
        : 'Sign in (free 3-day trial) to use the AI tools.'
    )
  }
  await connectEvents()
  const job = await api<JobInfo>('/jobs', { method: 'POST', body: JSON.stringify({ type, payload, episodeId }) })
  onJob(job)
  const done = await new Promise<JobInfo>((resolve) => {
    const cur = useJobs.getState().jobs[job.id]
    if (cur && FINISHED.includes(cur.status)) return resolve(cur)
    waiters.set(job.id, [...(waiters.get(job.id) ?? []), { resolve }])
    ensurePolling()
  })
  if (done.status !== 'done') throw new JobError(done)
  return done.result as T
}

export const cancelJob = (id: string) => api(`/jobs/${id}/cancel`, { method: 'POST', body: '{}' })

export const activeJobs = (jobs: Record<string, JobInfo>) =>
  Object.values(jobs).filter((j) => j.status === 'running' || j.status === 'queued')
