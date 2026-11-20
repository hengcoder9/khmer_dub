import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, HardDrive, KeyRound, Loader2, MemoryStick, Plus, X, XCircle } from 'lucide-react'
import type { JobInfo, SystemStats } from '@shared/types'
import { api } from '@/lib/api'
import { cn, formatGB } from '@/lib/utils'
import { activeJobs, cancelJob, useJobs } from '@/store/jobs'
import { addEpisode, removeEpisode, setActiveEpisode, useProject } from '@/store/project'
import { useUi } from '@/store/ui'
import { Popover, PopoverContent, PopoverTrigger, Progress } from '@/components/ui/controls'

function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => api<SystemStats>('/system/stats').then((s) => alive && setStats(s)).catch(() => {})
    load()
    const id = setInterval(load, 15_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return stats
}

function JobRow({ j }: { j: JobInfo }) {
  const ep = useProject((s) => s.project?.episodes.find((e) => e.id === j.episodeId)?.label)
  const live = j.status === 'running' || j.status === 'queued'
  return (
    <div className="flex flex-col gap-1 border-b py-2 last:border-0">
      <div className="flex items-center gap-2 text-sm">
        {ep && <span className="rounded bg-secondary px-1.5 font-mono text-[10px]">{ep}</span>}
        <span className="min-w-0 flex-1 truncate">{j.label}</span>
        <span
          className={cn(
            'text-[11px]',
            j.status === 'error' && 'text-destructive',
            j.status === 'done' && 'text-success',
            live && 'text-primary'
          )}
        >
          {j.status === 'running' ? `${Math.round(j.progress)}%` : j.status}
        </span>
        {live && (
          <button className="rounded p-0.5 hover:bg-accent" title="Cancel" onClick={() => cancelJob(j.id)}>
            <XCircle className="size-3.5" />
          </button>
        )}
      </div>
      {live && <Progress value={j.progress} />}
      {(j.message || j.error) && (
        <div className={cn('truncate text-[11px]', j.error ? 'text-destructive' : 'text-muted-foreground')} title={j.error ?? j.message}>
          {j.error ?? j.message}
        </div>
      )}
    </div>
  )
}

export function Footer() {
  const { t } = useTranslation()
  const stats = useSystemStats()
  const jobs = useJobs((s) => s.jobs)
  const keys = useJobs((s) => s.keys)
  const episodes = useProject((s) => s.project?.episodes ?? [])
  const activeId = useProject((s) => s.activeId ?? s.project?.episodes[0]?.id)
  const setUi = useUi((s) => s.set)
  const running = activeJobs(jobs)
  const list = Object.values(jobs).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)
  const current = running.find((j) => j.status === 'running')

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t bg-card px-2 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {episodes.map((e) => (
          <div
            key={e.id}
            className={cn(
              'group flex shrink-0 items-center gap-1 rounded-t border-x border-t px-2.5 py-1 font-mono',
              e.id === activeId ? 'bg-background text-foreground' : 'border-transparent hover:bg-accent'
            )}
          >
            <button onClick={() => setActiveEpisode(e.id)} title={e.media?.name ?? ''}>
              {e.label}
            </button>
            {episodes.length > 1 && (
              <button
                className="opacity-0 group-hover:opacity-70"
                title={t('footer.closeEpisode', 'Remove episode')}
                onClick={() => confirm(`${t('footer.removeConfirm', 'Remove episode')} ${e.label}?`) && removeEpisode(e.id)}
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
        <button className="rounded p-1 hover:bg-accent" title={t('footer.addEpisode', 'Add episode')} onClick={addEpisode}>
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="flex-1" />

      <Popover>
        <PopoverTrigger asChild>
          <button className="flex max-w-[40ch] items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-accent">
            {running.length ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <Activity className="size-3.5" />}
            {current ? (
              <span className="truncate">
                {current.label} · {Math.round(current.progress)}%{running.length > 1 ? ` (+${running.length - 1})` : ''}
              </span>
            ) : (
              <span>
                {t('footer.jobs', 'Jobs')}: {running.length || t('footer.idle', 'Idle')}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="max-h-[60vh] w-[420px] overflow-y-auto p-2">
          <div className="px-1 pb-1 text-sm font-medium text-foreground">{t('footer.jobs', 'Jobs')}</div>
          {list.length ? list.map((j) => <JobRow key={j.id} j={j} />) : <div className="p-2 text-sm text-muted-foreground">{t('footer.noJobs', 'No jobs yet')}</div>}
        </PopoverContent>
      </Popover>

      <button
        className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent', keys.total && keys.ready < keys.total && 'text-warning')}
        title={t('footer.keysTitle', 'Gemini API key pool (ready / total)')}
        onClick={() => setUi({ settings: 'apiKeys' })}
      >
        <KeyRound className="size-3.5" /> {t('footer.keys', 'Keys')} {keys.ready}/{keys.total}
      </button>
      {stats && (
        <>
          <span className="flex items-center gap-1">
            <MemoryStick className="size-3.5" /> {formatGB(stats.memTotal - stats.memFree)} / {formatGB(stats.memTotal)}
          </span>
          {stats.diskTotal > 0 && (
            <span className="flex items-center gap-1">
              <HardDrive className="size-3.5" /> {formatGB(stats.diskFree)} {t('footer.free', 'free')}
            </span>
          )}
        </>
      )}
    </footer>
  )
}
