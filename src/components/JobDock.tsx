import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, X, XCircle } from 'lucide-react'
import type { JobInfo } from '@shared/types'
import { cancelJob, useJobs } from '@/store/jobs'
import { useProject } from '@/store/project'
import { jobMeta, QUIET_JOBS } from '@/lib/jobmeta'
import { cn } from '@/lib/utils'

/** how long a finished job stays on screen */
const LINGER_MS = 9000
const MAX_LIVE = 3

function JobCard({ j, onDismiss }: { j: JobInfo; onDismiss: () => void }) {
  const { t } = useTranslation()
  const ep = useProject((s) => s.project?.episodes.find((e) => e.id === j.episodeId)?.label)
  const meta = jobMeta(j)
  const live = j.status === 'running' || j.status === 'queued'
  const Icon = j.status === 'done' ? CheckCircle2 : j.status === 'error' ? XCircle : meta.icon
  const state =
    j.status === 'done'
      ? t('dock.completed', 'Completed')
      : j.status === 'error'
        ? t('dock.failed', 'Failed')
        : j.status === 'queued'
          ? t('dock.queued', 'Queued')
          : t('dock.live', 'Live processing')
  return (
    <div className="studio-glass pointer-events-auto relative flex w-[360px] gap-3 overflow-hidden rounded-xl p-3">
      <div
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          j.status === 'done' ? 'bg-success/15 text-success' : j.status === 'error' ? 'bg-destructive/15 text-destructive' : meta.tint
        )}
      >
        {j.status === 'running' ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      </div>
      <div className="min-w-0 flex-1 pr-4">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{t(`jobGroup.${j.type.split('.').pop()}`, meta.group)}</span>
          <span>·</span>
          <span className={cn('font-medium', j.status === 'done' && 'text-success', j.status === 'error' && 'text-destructive', live && 'text-primary')}>{state}</span>
          {live && <span className="ml-auto font-mono tabular-nums text-foreground">{Math.round(j.progress)}%</span>}
        </div>
        <div className="mt-0.5 truncate text-sm font-semibold" title={j.label}>
          {ep && <span className="mr-1 font-mono text-xs text-primary">{ep}</span>}
          {j.label}
        </div>
        {(j.error || j.message) && (
          <div className={cn('mt-0.5 line-clamp-2 text-xs', j.error ? 'text-destructive' : 'text-muted-foreground')} title={j.error ?? j.message}>
            {j.error ?? j.message}
          </div>
        )}
        {live && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn('h-full rounded-full bg-brand transition-[width]', j.status === 'queued' && 'animate-shimmer opacity-40')}
                style={{ width: `${j.status === 'queued' ? 100 : Math.max(2, j.progress)}%` }}
              />
            </div>
            <button className="text-[11px] font-medium text-destructive hover:underline" onClick={() => cancelJob(j.id)}>
              {t('dock.stop', 'Stop')}
            </button>
          </div>
        )}
      </div>
      {!live && (
        <button className="absolute right-2 top-2 rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100" onClick={onDismiss}>
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** Floating live-processing cards (bottom-right): a notification centre for backend jobs. */
export function JobDock() {
  const { t } = useTranslation()
  const jobs = useJobs((s) => s.jobs)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [mountedAt] = useState(() => Date.now())
  const [collapsed, setCollapsed] = useState(false)
  const [now, setNow] = useState(Date.now())

  const { live, recent } = useMemo(() => {
    const all = Object.values(jobs).filter((j) => !QUIET_JOBS.has(j.type) && !dismissed.has(j.id))
    return {
      live: all
        .filter((j) => j.status === 'running' || j.status === 'queued')
        .sort((a, b) => (a.status === b.status ? a.createdAt - b.createdAt : a.status === 'running' ? -1 : 1)),
      recent: all
        .filter((j) => j.finishedAt && j.finishedAt > mountedAt && now - j.finishedAt < LINGER_MS && j.status !== 'canceled')
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    }
  }, [jobs, dismissed, mountedAt, now])

  // keep the clock moving while a finished card is waiting to fade out
  useEffect(() => {
    if (!recent.length) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [recent.length])
  useEffect(() => setNow(Date.now()), [jobs])

  const cards = [...recent.slice(0, 2), ...live.slice(0, MAX_LIVE)]
  const hidden = live.length - Math.min(live.length, MAX_LIVE)
  if (!cards.length) return null

  return (
    <div className="pointer-events-none fixed bottom-11 right-3 z-40 flex flex-col items-end gap-2">
      {!collapsed && cards.map((j) => <JobCard key={j.id} j={j} onDismiss={() => setDismissed((s) => new Set([...s, j.id]))} />)}
      <div className="studio-glass pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1 text-[11px]">
        {live.length > 0 && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
        <span className="text-muted-foreground">
          {t('dock.summary', '{{n}} live', { n: live.length })}
          {hidden > 0 && ` · +${hidden} ${t('dock.more', 'more')}`}
        </span>
        {recent.length > 0 && (
          <button className="font-medium hover:text-primary" onClick={() => setDismissed((s) => new Set([...s, ...recent.map((r) => r.id)]))}>
            {t('dock.clear', 'Clear all')}
          </button>
        )}
        <button className="rounded-full p-0.5 hover:bg-accent" title={collapsed ? t('dock.expand', 'Show') : t('dock.collapse', 'Hide')} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>
    </div>
  )
}
