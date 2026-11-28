import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AudioLines, Check, CloudUpload, Factory, Network, FilePlus2, FolderOpen, Loader2, Redo2, Settings, TriangleAlert, Undo2, X } from 'lucide-react'
import { APP_NAME } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/store/settings'
import { closeProject, openProject, redo, undo, useActiveEpisode, useProject } from '@/store/project'
import { useUi } from '@/store/ui'
import { activeJobs, useJobs } from '@/store/jobs'
import { jobMeta, QUIET_JOBS } from '@/lib/jobmeta'
import { DisplayPopover } from '@/features/display/DisplayPopover'
import { AccountChip } from '@/features/account/AccountChip'
import { cn } from '@/lib/utils'

export async function pickAndOpenProject() {
  const p = await window.api.openFile({ title: 'Open project', filters: [{ name: 'KhmerDub project', extensions: ['json'] }] })
  if (!p) return
  try {
    const r = await openProject(p)
    useSettings.getState().addRecent({ name: r.project.name, dir: r.dir })
  } catch (e) {
    toast.error((e as Error).message)
  }
}

function SaveState() {
  const { t } = useTranslation()
  const saving = useProject((s) => s.saving)
  const err = useProject((s) => s.saveError)
  if (saving === 'error')
    return (
      <span className="flex items-center gap-1 text-xs text-destructive" title={err}>
        <TriangleAlert className="size-3.5" /> {t('top.saveFailed', 'Save failed')}
      </span>
    )
  if (saving === 'pending' || saving === 'saving')
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> {t('top.saving', 'Saving…')}
      </span>
    )
  return (
    <span className="flex items-center gap-1 text-xs text-success">
      <Check className="size-3.5" /> {t('top.saved', 'Saved')}
    </span>
  )
}

/** Dark "now processing" capsule in the middle of the top bar: current job, its progress ring and how many run. */
function LivePill() {
  const { t } = useTranslation()
  const jobs = useJobs((s) => s.jobs)
  const running = activeJobs(jobs).filter((j) => !QUIET_JOBS.has(j.type))
  const cur = running.find((j) => j.status === 'running') ?? running[0]
  const ep = useProject((s) => s.project?.episodes.find((e) => e.id === cur?.episodeId)?.label)
  if (!cur) return null
  const pct = Math.round(cur.status === 'running' ? cur.progress : 0)
  const r = 9
  const c = 2 * Math.PI * r
  return (
    <div
      className="flex h-8 max-w-[440px] items-center gap-2.5 rounded-full bg-neutral-900 py-1 pl-1 pr-3 text-white shadow-lg ring-1 ring-white/10 dark:bg-black"
      title={`${cur.label}${cur.message ? ` — ${cur.message}` : ''}`}
    >
      <svg viewBox="0 0 24 24" className="size-6 shrink-0 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <circle cx="12" cy="12" r={r} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className="transition-[stroke-dashoffset]" />
      </svg>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-xs font-semibold">
          {t(`jobGroup.${cur.type.split('.').pop()}`, jobMeta(cur).group)}
          {ep && ` · ${ep}`}
        </div>
        <div className="text-[10px] text-white/60">
          {running.length > 1 ? t('top.liveMore', '{{n}} jobs running', { n: running.length }) : cur.label}
        </div>
      </div>
      <span className="ml-1 font-mono text-xs font-semibold tabular-nums">{pct}%</span>
    </div>
  )
}

export function TopBar() {
  const { t } = useTranslation()
  const { lang, setLang } = useSettings()
  const project = useProject((s) => s.project)
  const canUndo = useProject((s) => s.past.length > 0)
  const canRedo = useProject((s) => s.future.length > 0)
  const ep = useActiveEpisode()
  const setUi = useUi((s) => s.set)

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-2 border-b bg-card/80 px-3 backdrop-blur-xl dark:bg-card">
      <div className="mr-1 flex items-center gap-2">
        <div className="relative grid size-7 place-items-center rounded-lg bg-brand text-primary-foreground">
          <AudioLines className="size-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">{APP_NAME}</span>
      </div>
      {project && (
        <div className="ml-2 flex min-w-0 items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1">
          <span className="max-w-[22ch] truncate text-sm font-medium" title={project.name}>
            {project.name}
          </span>
          {ep && <span className="rounded-md bg-brand px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary-foreground">{ep.label}</span>}
          {ep?.media && (
            <span className="max-w-[24ch] truncate text-xs text-muted-foreground" title={ep.videoPath}>
              {ep.media.name}
            </span>
          )}
          <span className="h-4 w-px bg-border" />
          <SaveState />
        </div>
      )}

      <div className="flex min-w-0 flex-1 justify-center px-2">
        <LivePill />
      </div>

      <div className="flex items-center gap-0.5 rounded-xl border bg-background/60 p-0.5">
        <Button variant="ghost" size="icon" title={t('top.newProject', 'New project')} onClick={() => setUi({ dialog: 'newProject' })}>
          <FilePlus2 />
        </Button>
        <Button variant="ghost" size="icon" title={t('top.openProject', 'Open project')} onClick={pickAndOpenProject}>
          <FolderOpen />
        </Button>
        {project && (
          <Button variant="ghost" size="icon" title={t('top.closeProject', 'Close project')} onClick={() => closeProject()}>
            <X />
          </Button>
        )}
        <span className="mx-0.5 h-5 w-px bg-border" />
        <Button variant="ghost" size="icon" title={t('top.undo', 'Undo (Ctrl+Z)')} disabled={!canUndo} onClick={undo}>
          <Undo2 />
        </Button>
        <Button variant="ghost" size="icon" title={t('top.redo', 'Redo (Ctrl+Y)')} disabled={!canRedo} onClick={redo}>
          <Redo2 />
        </Button>
      </div>

      {project && (
        <Button variant="outline" size="sm" onClick={() => setUi({ dialog: 'automate' })} title={t('top.batchTitle', 'Batch automation — dub many episodes')}>
          <Factory /> {t('top.batch', 'Batch')}
        </Button>
      )}
      {project && (
        <Button size="sm" className="bg-brand px-4 font-semibold shadow-md shadow-primary/25 hover:brightness-110" onClick={() => setUi({ dialog: 'export' })} title={t('top.export', 'Export')}>
          <CloudUpload /> {t('top.export', 'Export')}
        </Button>
      )}
      <div className={cn('flex items-center gap-0.5')}>
        <Button variant="ghost" size="icon" title={t('top.gateway', 'AI Gateway — key routing & live telemetry')} onClick={() => setUi({ dialog: 'gateway' })}>
          <Network />
        </Button>
        <DisplayPopover />
        <Button variant="ghost" size="sm" className="w-12" title={t('top.language', 'Switch language')} onClick={() => setLang(lang === 'en' ? 'km' : 'en')}>
          {lang === 'en' ? 'ខ្មែរ' : 'EN'}
        </Button>
        <Button variant="ghost" size="icon" title={t('top.settings', 'Settings (Ctrl+,)')} onClick={() => setUi({ settings: 'general' })}>
          <Settings />
        </Button>
        <span className="ml-1"><AccountChip /></span>
      </div>
    </header>
  )
}
