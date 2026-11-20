import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AudioLines, Clock, FilePlus2, FolderOpen, Settings } from 'lucide-react'
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
    <div className="grid h-full place-items-center bg-background p-8">
      <div className="absolute right-4 top-4 flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'en' ? 'km' : 'en')}>
          {lang === 'en' ? 'ខ្មែរ' : 'EN'}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setUi({ settings: 'general' })}>
          <Settings />
        </Button>
      </div>
      <div className="flex w-full max-w-3xl flex-col gap-8">
        <div className="flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <AudioLines className="size-8" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
            <p className="text-muted-foreground">{t('welcome.tagline', 'AI dubbing & video editing — Khmer first')}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setUi({ dialog: 'newProject' })}
            className="flex items-center gap-3 rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-accent"
          >
            <FilePlus2 className="size-7 text-primary" />
            <div>
              <div className="font-medium">{t('welcome.new', 'New project')}</div>
              <div className="text-sm text-muted-foreground">{t('welcome.newHint', 'Start from a video, SRT or a whole series')}</div>
            </div>
          </button>
          <button
            onClick={pickAndOpenProject}
            className="flex items-center gap-3 rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-accent"
          >
            <FolderOpen className="size-7 text-primary" />
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
            <div className="flex flex-col divide-y rounded-xl border bg-card">
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
