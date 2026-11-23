import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AudioLines, Clock, Cpu, FilePlus2, FolderOpen, Languages, Mic2, Settings, Sparkles } from 'lucide-react'
import { DisplayPopover } from '@/features/display/DisplayPopover'
import { AccountChip } from '@/features/account/AccountChip'
import { APP_NAME } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/store/settings'
import { openProject } from '@/store/project'
import { useUi } from '@/store/ui'
import { pickAndOpenProject } from '@/components/TopBar'

export function Welcome() {
  const { t } = useTranslation()
  const recent = useSettings((s) => s.recent)
  const setUi = useUi((s) => s.set)
  const { lang, setLang } = useSettings()

  const openRecent = async (dir: string) => {
    try {
      const r = await openProject(dir)
      useSettings.getState().addRecent({ name: r.project.name, dir: r.dir })
    } catch (e) {
      toast.error((e as Error).message)
      useSettings.getState().set({ recent: useSettings.getState().recent.filter((x) => x.dir !== dir) })
    }
  }

  return (
    <div className="relative grid h-full place-items-center overflow-y-auto p-8">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <AccountChip />
        <DisplayPopover />
        <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'en' ? 'km' : 'en')}>
          {lang === 'en' ? 'ខ្មែរ' : 'EN'}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setUi({ settings: 'general' })}>
          <Settings />
        </Button>
      </div>
      <div className="flex w-full max-w-3xl flex-col gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative">
            <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-primary/30 blur-3xl" />
            <div className="grid size-20 place-items-center rounded-3xl bg-brand text-primary-foreground shadow-2xl shadow-primary/40">
              <AudioLines className="size-10" />
            </div>
          </div>
          <span className="chip border-primary/30 bg-primary/10 text-primary">
            <Sparkles className="size-3" /> {t('welcome.badge', 'AI-powered Khmer dubbing studio')}
          </span>
          <h1 className="text-brand text-4xl font-bold tracking-tight">{APP_NAME}</h1>
          <p className="max-w-xl text-muted-foreground">{t('welcome.tagline', 'AI dubbing & video editing — Khmer first')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {(
              [
                [Languages, t('welcome.f1', 'Transcribe + translate')],
                [Mic2, t('welcome.f2', 'Neural Khmer voices & cloning')],
                [Cpu, t('welcome.f3', 'Batch factory for whole series')]
              ] as const
            ).map(([Icon, label]) => (
              <span key={label} className="chip bg-card py-1 text-muted-foreground">
                <Icon className="size-3.5 text-primary" /> {label}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setUi({ dialog: 'newProject' })}
            className="studio-card group flex items-center gap-4 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60"
          >
            <span className="grid size-12 place-items-center rounded-xl bg-brand text-primary-foreground shadow-md shadow-primary/30"><FilePlus2 className="size-6" /></span>
            <div>
              <div className="font-medium">{t('welcome.new', 'New project')}</div>
              <div className="text-sm text-muted-foreground">{t('welcome.newHint', 'Start from a video, SRT or a whole series')}</div>
            </div>
          </button>
          <button
            onClick={pickAndOpenProject}
            className="studio-card group flex items-center gap-4 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60"
          >
            <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary"><FolderOpen className="size-6" /></span>
            <div>
              <div className="font-medium">{t('welcome.open', 'Open project')}</div>
              <div className="text-sm text-muted-foreground">{t('welcome.openHint', 'Pick a project.json')}</div>
            </div>
          </button>
        </div>
        {recent.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="size-4" /> {t('welcome.recent', 'Recent projects')}
            </div>
            <div className="studio-card flex flex-col divide-y overflow-hidden">
              {recent.map((r) => (
                <button key={r.dir} onClick={() => openRecent(r.dir)} className="flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent">
                  <span className="font-medium">{r.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.dir}</span>
                  <span className="text-xs text-muted-foreground">{new Date(r.openedAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <button className="self-start text-sm text-primary hover:underline" onClick={() => setUi({ settings: 'engines' })}>
          {t('welcome.engines', 'First time? Install the AI engines → Settings → Engines')}
        </button>
      </div>
    </div>
  )
}
