import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AudioWaveform, Captions, CheckCircle2, Film, FolderOpen, Languages, Mic2, Play, Users, Vault, Wand2, XCircle, Zap, type LucideIcon } from 'lucide-react'
import type { Episode, JobInfo } from '@shared/types'
import { cn } from '@/lib/utils'

export type StepId = 'separate' | 'transcribe' | 'diarize' | 'translate' | 'cast' | 'tts' | 'export'
export type StepState = 'wait' | 'run' | 'done' | 'skip' | 'error'

const STATION: Record<StepId, { icon: LucideIcon; tint: string; bar: string; job?: string }> = {
  separate: { icon: AudioWaveform, tint: 'text-fuchsia-500 bg-fuchsia-500/10 border-fuchsia-500/30', bar: 'from-fuchsia-500 to-violet-500', job: 'separate' },
  transcribe: { icon: Captions, tint: 'text-blue-500 bg-blue-500/10 border-blue-500/30', bar: 'from-blue-500 to-sky-400', job: 'transcribe' },
  diarize: { icon: Users, tint: 'text-amber-500 bg-amber-500/10 border-amber-500/30', bar: 'from-amber-500 to-orange-400', job: 'diarize' },
  translate: { icon: Languages, tint: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/30', bar: 'from-indigo-500 to-violet-400', job: 'translate' },
  cast: { icon: Wand2, tint: 'text-orange-500 bg-orange-500/10 border-orange-500/30', bar: 'from-orange-500 to-amber-400' },
  tts: { icon: Mic2, tint: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30', bar: 'from-emerald-500 to-lime-400', job: 'tts' },
  export: { icon: Film, tint: 'text-cyan-500 bg-cyan-500/10 border-cyan-500/30', bar: 'from-cyan-500 to-blue-500', job: 'export' }
}

interface Props {
  episodes: Episode[]
  steps: Array<[StepId, string, boolean]>
  status: Record<string, Partial<Record<StepId, StepState>>>
  jobs: Record<string, JobInfo>
  startedAt: number | null
  finishedAt: Record<string, number>
  running: boolean
  parallel: number
  exportDir: (e: Episode) => string
}

const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`
}

export function BatchCockpit({ episodes, steps, status, jobs, startedAt, finishedAt, running, parallel, exportDir }: Props) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now())
  const [inspect, setInspect] = useState<string | null>(null)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const on = steps.filter(([, , enabled]) => enabled)

  /** live job (if any) for an episode at a step */
  const jobFor = (epId: string, step: StepId) => {
    const type = STATION[step].job
    if (!type) return undefined
    return Object.values(jobs)
      .filter((j) => j.episodeId === epId && j.type === type && (j.status === 'running' || j.status === 'queued'))
      .sort((a, b) => b.createdAt - a.createdAt)[0]
  }

  const rows = useMemo(
    () =>
      episodes.map((e) => {
        const st = status[e.id] ?? {}
        const finished = on.filter(([id]) => st[id] === 'done' || st[id] === 'skip' || st[id] === 'error').length
        const cur = on.find(([id]) => st[id] === 'run')
        const job = cur ? jobFor(e.id, cur[0]) : undefined
        const frac = job && job.status === 'running' ? job.progress / 100 : 0
        const pct = on.length ? (100 * (finished + frac)) / on.length : 0
        const failed = Object.values(st).includes('error') && !cur && !finishedAt[e.id]
        const state: 'done' | 'active' | 'failed' | 'hold' = finishedAt[e.id] ? 'done' : cur ? 'active' : failed ? 'failed' : 'hold'
        return { e, st, pct, cur: cur?.[0], curLabel: cur?.[1], job, state }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodes, status, jobs, finishedAt, steps]
  )

  const done = rows.filter((r) => r.state === 'done')
  const active = rows.filter((r) => r.state === 'active')
  const hold = rows.filter((r) => r.state === 'hold')
  const failed = rows.filter((r) => r.state === 'failed')
  const elapsed = startedAt ? (running ? now : Math.max(...Object.values(finishedAt), startedAt)) - startedAt : 0
  const perMin = elapsed > 30_000 && done.length ? done.length / (elapsed / 60_000) : 0
  const overall = rows.length ? rows.reduce((a, r) => a + r.pct, 0) / rows.length : 0
  const eta = perMin > 0 ? ((rows.length - done.length - failed.length) / perMin) * 60_000 : 0
  const picked = rows.find((r) => r.e.id === inspect)

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* factory line */}
      <div className="rounded-xl border bg-gradient-to-br from-primary/5 via-transparent to-transparent p-3">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-brand text-primary-foreground">
            <Zap className="size-4" />
          </span>
          <span className="studio-label text-foreground">{t('cockpit.line', '{{n}}-station AI production line', { n: on.length })}</span>
          <span className={cn('chip', running ? 'border-success/40 bg-success/10 text-success' : 'text-muted-foreground')}>
            <span className={cn('size-1.5 rounded-full', running ? 'animate-pulse bg-success' : 'bg-muted-foreground')} />
            {running ? t('cockpit.active', 'Factory active') : t('cockpit.idle', 'Idle')}
          </span>
          <span className="ml-auto chip">
            <Zap className="size-3 text-primary" /> {active.length} {t('cockpit.activeN', 'active')} · {hold.length} {t('cockpit.hold', 'hold')}
          </span>
          <span className="chip border-primary/30 text-primary">
            {perMin ? perMin.toFixed(perMin < 1 ? 2 : 1) : '–'} EP/min
          </span>
        </div>

        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${on.length + 1}, minmax(0, 1fr))` }}>
          {on.map(([id, label], i) => {
            const meta = STATION[id]
            const here = rows.filter((r) => r.cur === id)
            const passed = rows.filter((r) => r.st[id] === 'done').length
            const lead = here[0]
            const leadPct = lead?.job?.status === 'running' ? Math.round(lead.job.progress) : 0
            return (
              <div key={id} className={cn('flex flex-col gap-2 rounded-xl border bg-card p-2.5', here.length && 'ring-1 ring-primary/30')}>
                <div className="flex items-center gap-1">
                  <span className={cn('rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold', meta.tint)}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="truncate text-[11px] font-semibold">{label}</span>
                </div>
                <div className={cn('relative grid h-14 place-items-center overflow-hidden rounded-lg border', meta.tint)}>
                  <meta.icon className={cn('size-6', here.length && 'animate-pulse')} />
                  {here.length > 0 && <span className="animate-scan absolute top-0 h-full w-0.5 bg-current opacity-60" />}
                </div>
                <div className="flex min-h-5 flex-wrap gap-1">
                  {here.length ? (
                    here.map((r) => (
                      <span key={r.e.id} className="chip border-primary/40 bg-primary/10 px-1.5 font-mono text-[10px] text-primary">
                        {r.e.label}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-muted-foreground">{passed ? t('cockpit.ready', 'Ready') : t('cockpit.standby', 'Standby')}</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    {passed}/{rows.length}
                  </span>
                  <span className={cn(here.length && 'text-primary')}>{here.length ? `${leadPct}%` : ''}</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-secondary">
                  <div className={cn('h-full rounded-full bg-gradient-to-r transition-[width]', meta.bar)} style={{ width: `${here.length ? leadPct : rows.length ? (100 * passed) / rows.length : 0}%` }} />
                </div>
              </div>
            )
          })}

          {/* ready vault */}
          <div className="flex flex-col gap-2 rounded-xl border border-success/30 bg-success/5 p-2.5">
            <div className="flex items-center gap-1 text-[11px] font-semibold">
              <Vault className="size-3.5 text-success" /> {t('cockpit.vault', 'Ready vault')}
              <span className="ml-auto rounded-full bg-success/15 px-1.5 font-mono text-[10px] text-success">
                {done.length}/{rows.length}
              </span>
            </div>
            <div className="flex max-h-28 flex-col gap-1 overflow-y-auto">
              {done.length ? (
                [...done]
                  .sort((a, b) => finishedAt[b.e.id] - finishedAt[a.e.id])
                  .map((r) => (
                    <div key={r.e.id} className="flex items-center gap-1 rounded-md border bg-card px-1.5 py-1 text-[10px]">
                      <CheckCircle2 className="size-3 text-success" />
                      <span className="font-mono font-semibold">{r.e.label}</span>
                      <button className="ml-auto rounded p-0.5 hover:bg-accent" title={t('cockpit.open', 'Open folder')} onClick={() => window.api.showInFolder(exportDir(r.e))}>
                        <FolderOpen className="size-3" />
                      </button>
                    </div>
                  ))
              ) : (
                <span className="text-[10px] text-muted-foreground">{t('cockpit.vaultEmpty', 'Finished MP4s land here')}</span>
              )}
            </div>
            <div className="mt-auto flex justify-between text-[10px] text-muted-foreground">
              <span>{t('cockpit.yield', 'Yield')}</span>
              <span className="font-semibold text-success">{rows.length ? Math.round((100 * done.length) / rows.length) : 0}%</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('cockpit.intake', 'Intake')}
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-blue-500 to-emerald-500 transition-[width] duration-700" style={{ width: `${overall}%` }} />
          </div>
          {t('cockpit.master', 'Master MP4')} · {Math.round(overall)}%
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-[1fr_260px] gap-3">
        {/* conveyor */}
        <div className="flex min-h-0 flex-col rounded-xl border p-3">
          <div className="mb-2 flex items-center">
            <span className="studio-label">{t('cockpit.conveyor', 'Live parallel conveyor')}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {t('cockpit.lanes', '{{n}} lanes · click to inspect', { n: parallel })}
            </span>
          </div>
          <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
            {[...rows]
              .sort((a, b) => ['active', 'hold', 'failed', 'done'].indexOf(a.state) - ['active', 'hold', 'failed', 'done'].indexOf(b.state))
              .map((r) => (
                <button
                  key={r.e.id}
                  onClick={() => setInspect(r.e.id === inspect ? null : r.e.id)}
                  className={cn('flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-accent', inspect === r.e.id && 'bg-primary/5 ring-1 ring-primary/30')}
                >
                  <span className="w-14 shrink-0 font-mono text-xs font-semibold">{r.e.label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        'h-full rounded-full bg-gradient-to-r transition-[width] duration-500',
                        r.state === 'done' ? 'from-emerald-500 to-lime-400' : r.state === 'failed' ? 'from-rose-500 to-red-400' : r.cur ? STATION[r.cur].bar : 'from-amber-400 to-yellow-300'
                      )}
                      style={{ width: `${Math.max(r.state === 'hold' ? 0 : 3, r.pct)}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      'w-36 shrink-0 truncate text-right text-[11px]',
                      r.state === 'done' ? 'text-success' : r.state === 'failed' ? 'text-destructive' : r.state === 'active' ? 'text-primary' : 'text-muted-foreground'
                    )}
                  >
                    {r.state === 'done'
                      ? t('cockpit.exported', 'Exported ✓')
                      : r.state === 'failed'
                        ? t('cockpit.failed', 'Failed')
                        : r.state === 'active'
                          ? `${r.curLabel} ${r.job?.status === 'running' ? `${Math.round(r.job.progress)}%` : ''}`
                          : t('cockpit.queue', 'Queue hold')}
                  </span>
                </button>
              ))}
          </div>
        </div>

        {/* speed + inspector */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 rounded-xl border p-3">
            {(
              [
                [t('cockpit.elapsed', 'Elapsed'), startedAt ? fmtDur(elapsed) : '–'],
                [t('cockpit.eta', 'ETA'), running && eta ? fmtDur(eta) : '–'],
                [t('cockpit.done', 'Done'), `${done.length}/${rows.length}`],
                [t('cockpit.failedN', 'Failed'), String(failed.length)]
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <div className="studio-label">{k}</div>
                <div className="font-mono text-lg font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <div className="flex-1 rounded-xl border p-3">
            <div className="studio-label mb-2">{picked ? `${t('cockpit.inspect', 'Inspector')} · ${picked.e.label}` : t('cockpit.inspect', 'Inspector')}</div>
            {picked ? (
              <div className="flex flex-col gap-1">
                {on.map(([id, label]) => {
                  const s = picked.st[id]
                  const M = STATION[id]
                  return (
                    <div key={id} className="flex items-center gap-2 text-xs">
                      <M.icon className="size-3.5 text-muted-foreground" />
                      <span className="flex-1">{label}</span>
                      {s === 'done' ? (
                        <CheckCircle2 className="size-3.5 text-success" />
                      ) : s === 'error' ? (
                        <XCircle className="size-3.5 text-destructive" />
                      ) : s === 'run' ? (
                        <Play className="size-3.5 animate-pulse text-primary" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">{s === 'skip' ? t('cockpit.skip', 'skip') : '…'}</span>
                      )}
                    </div>
                  )
                })}
                {picked.job?.message && <div className="mt-1 truncate text-[11px] text-muted-foreground">{picked.job.message}</div>}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">{t('cockpit.inspectHint', 'Click an episode lane to see each station.')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
