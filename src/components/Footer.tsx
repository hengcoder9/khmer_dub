import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Cpu, Gauge, HardDrive, KeyRound, Loader2, MemoryStick, Octagon, Plus, Sparkles, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { JobInfo, SystemStats } from '@shared/types'
import { api, post } from '@/lib/api'
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
    const id = setInterval(load, 3_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return stats
}

/** tiny labelled usage bar for the status strip */
function Meter({ icon: Icon, label, pct, text, title }: { icon: typeof Cpu; label: string; pct: number; text: string; title?: string }) {
  const tone = pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-warning' : 'bg-brand'
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <Icon className="size-3.5" />
      <span className="font-medium text-foreground/80">{label}</span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-secondary">
        <span className={cn('block h-full rounded-full transition-[width] duration-700', tone)} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </span>
      <span className="font-mono tabular-nums">{text}</span>
    </span>
  )
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

  const stopAll = () => {
    running.forEach((j) => cancelJob(j.id))
    toast.info(t('footer.stopped', 'Stopping {{n}} job(s)', { n: running.length }))
  }
  const freeVram = () =>
    post('/system/free-vram', {})
      .then(() => toast.success(t('footer.vramFreed', 'AI engines unloaded — GPU memory released. They restart on the next job.')))
      .catch((e: Error) => toast.error(e.message))

  return (
    <footer className="mt-2 flex h-8 shrink-0 items-center gap-4 border-t bg-card/80 px-2 text-xs text-muted-foreground backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {episodes.map((e) => (
          <div
            key={e.id}
            className={cn(
              'group flex shrink-0 items-center gap-1 rounded-md px-2.5 py-0.5 font-mono',
              e.id === activeId ? 'bg-brand font-semibold text-primary-foreground shadow-sm' : 'hover:bg-accent'
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
        title={t('footer.keysTitle', 'AI Gateway — Gemini key pool (ready / total)')}
        onClick={() => setUi({ dialog: 'gateway' })}
      >
        <KeyRound className="size-3.5" /> {t('footer.keys', 'Keys')} {keys.ready}/{keys.total}
      </button>
      {stats && (
        <>
          {stats.cpu !== undefined && <Meter icon={Cpu} label="CPU" pct={stats.cpu} text={`${Math.round(stats.cpu)}%`} title={`${stats.cores ?? ''} cores`} />}
          <Meter
            icon={MemoryStick}
            label="RAM"
            pct={(100 * (stats.memTotal - stats.memFree)) / stats.memTotal}
            text={`${formatGB(stats.memTotal - stats.memFree).replace(' GB', '')}/${formatGB(stats.memTotal)}`}
          />
          {stats.gpu && (
            <Meter
              icon={Gauge}
              label="VRAM"
              pct={(100 * stats.gpu.memUsed) / Math.max(1, stats.gpu.memTotal)}
              text={`${(stats.gpu.memUsed / 1024).toFixed(1)}/${(stats.gpu.memTotal / 1024).toFixed(0)} GB · ${Math.round(stats.gpu.load)}%`}
              title={`${stats.gpu.name} — ${stats.gpu.memUsed}/${stats.gpu.memTotal} MiB, ${Math.round(stats.gpu.load)}% load`}
            />
          )}
          {stats.diskTotal > 0 && (
            <span className="flex items-center gap-1">
              <HardDrive className="size-3.5" /> {formatGB(stats.diskFree)} {t('footer.free', 'free')}
            </span>
          )}
        </>
      )}
      {running.length > 0 && (
        <button className="flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 font-medium text-destructive hover:bg-destructive/20" onClick={stopAll}>
          <Octagon className="size-3.5" /> {t('footer.stopAll', 'Stop All')}
        </button>
      )}
      {stats?.gpu && (
        <button
          className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
          disabled={running.length > 0}
          title={t('footer.freeVramTitle', 'Unload Whisper / Demucs / voice-clone engines to free GPU memory')}
          onClick={freeVram}
        >
          <Sparkles className="size-3.5" /> {t('footer.freeVram', 'Free VRAM')}
        </button>
      )}
    </footer>
  )
}
