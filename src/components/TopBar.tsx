import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AudioLines, Check, CloudUpload, FilePlus2, FolderOpen, Loader2, Monitor, Moon, Redo2, Settings, Sun, TriangleAlert, Undo2, X } from 'lucide-react'
import { APP_NAME } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useSettings, type Theme } from '@/store/settings'
import { closeProject, openProject, redo, undo, useActiveEpisode, useProject } from '@/store/project'
import { useUi } from '@/store/ui'

const NEXT_THEME: Record<Theme, Theme> = { dark: 'light', light: 'system', system: 'dark' }
const THEME_ICON = { dark: Moon, light: Sun, system: Monitor }

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
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Check className="size-3.5" /> {t('top.saved', 'Saved')}
    </span>
  )
}

export function TopBar() {
  const { t } = useTranslation()
  const { theme, setTheme, lang, setLang } = useSettings()
  const project = useProject((s) => s.project)
  const canUndo = useProject((s) => s.past.length > 0)
  const canRedo = useProject((s) => s.future.length > 0)
  const ep = useActiveEpisode()
  const setUi = useUi((s) => s.set)
  const ThemeIcon = THEME_ICON[theme]

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
      <div className="mr-1 flex items-center gap-2">
        <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
          <AudioLines className="size-4" />
        </div>
        <span className="font-semibold tracking-tight">{APP_NAME}</span>
      </div>
      {project && (
        <>
          <span className="max-w-[28ch] truncate text-sm font-medium" title={project.name}>
            {project.name}
          </span>
          {ep && <span className="rounded bg-primary/15 px-2 py-0.5 font-mono text-xs text-primary">{ep.label}</span>}
          {ep?.media && (
            <span className="max-w-[32ch] truncate text-xs text-muted-foreground" title={ep.videoPath}>
              {ep.media.name}
            </span>
          )}
          <SaveState />
        </>
      )}

      <div className="flex-1" />

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
      <Button variant="ghost" size="icon" title={t('top.undo', 'Undo (Ctrl+Z)')} disabled={!canUndo} onClick={undo}>
        <Undo2 />
      </Button>
      <Button variant="ghost" size="icon" title={t('top.redo', 'Redo (Ctrl+Y)')} disabled={!canRedo} onClick={redo}>
        <Redo2 />
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      {project && (
        <Button size="sm" onClick={() => setUi({ dialog: 'export' })} title={t('top.export', 'Export')}>
          <CloudUpload /> {t('top.export', 'Export')}
        </Button>
      )}
      <Button variant="ghost" size="icon" title={t(`theme.${theme}`, theme)} onClick={() => setTheme(NEXT_THEME[theme])}>
        <ThemeIcon />
      </Button>
      <Button variant="ghost" size="sm" className="w-12" title={t('top.language', 'Switch language')} onClick={() => setLang(lang === 'en' ? 'km' : 'en')}>
        {lang === 'en' ? 'ខ្មែរ' : 'EN'}
      </Button>
      <Button variant="ghost" size="icon" title={t('top.settings', 'Settings (Ctrl+,)')} onClick={() => setUi({ settings: 'general' })}>
        <Settings />
      </Button>
    </header>
  )
}
