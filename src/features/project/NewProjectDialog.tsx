import { useEffect, useState } from 'react'
import { sortByEpisode } from '@shared/episodes'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Film, FolderOpen, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/controls'
import { createProject, projectsRoot, mutate, useProject, setEpisodeVideo } from '@/store/project'
import { useSettings } from '@/store/settings'
import { post } from '@/lib/api'
import { autoLines, VIDEO_FILTERS } from '@/lib/pipeline'
import { LANG_NAMES } from '@shared/translate'
import { episodeLabel, newEpisode } from '@shared/defaults'
import type { MediaInfo } from '@shared/types'

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [target, setTarget] = useState('km')
  const [videos, setVideos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    projectsRoot().then(setParent).catch(() => {})
  }, [])

  const pickVideos = async () => {
    const files = await window.api.openFiles({ filters: VIDEO_FILTERS, title: t('newProject.pickVideos', 'Pick one video, or several for a series (E01, E02…)') })
    if (files.length) {
      // episode order from the names ("Ep 3", "第3集", "ភាគ៣", "S01E03"…), not just alphabetical
      setVideos(sortByEpisode(files, (f) => f.split(/[\\/]/).pop()!))
      if (!name) setName(files[0].split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '').replace(/[ _-]*(e|ep|episode)?\s*\d+$/i, '') || 'Project')
    }
  }

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const r = await createProject(name.trim(), parent || undefined)
      useSettings.getState().addRecent({ name: r.project.name, dir: r.dir })
      mutate((p) => ({ ...p, settings: { ...p.settings, targetLang: target } }), { undo: false })
      // one episode per video
      for (let i = 0; i < videos.length; i++) {
        const info = await post<MediaInfo>('/media/probe', { path: videos[i] })
        let epId = useProject.getState().project!.episodes[i]?.id
        if (!epId) {
          const ep = { ...newEpisode(i + 1), label: episodeLabel(i + 1) }
          mutate((p) => ({ ...p, episodes: [...p.episodes, ep] }), { undo: false })
          epId = ep.id
        }
        setEpisodeVideo(epId, info)
        info.warnings.forEach((w) => toast.warning(`${info.name}: ${w}`))
      }
      useProject.setState({ past: [], future: [] })
      onClose()
      autoLines(useProject.getState().project!.episodes.map((e) => e.id))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[560px] p-6">
        <DialogTitle>{t('newProject.title', 'New project')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t('newProject.desc', 'A project holds one or more episodes that share the cast and glossary.')}
        </DialogDescription>
        <div className="flex flex-col gap-4">
          <Field label={t('newProject.name', 'Project name')}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My Drama" onKeyDown={(e) => e.key === 'Enter' && create()} />
          </Field>
          <Field label={t('newProject.videos', 'Videos')} hint={videos.length > 1 ? t('newProject.series', '{{n}} episodes will be created', { n: videos.length }) : undefined}>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={pickVideos}>
                <Film /> {t('newProject.pick', 'Choose video(s)…')}
              </Button>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {videos.length ? videos.map((v) => v.split(/[\\/]/).pop()).join(', ') : t('newProject.optional', 'Optional — you can import later')}
              </span>
            </div>
          </Field>
          <Field label={t('newProject.target', 'Dub into')}>
            <Select value={target} onChange={setTarget} options={Object.entries(LANG_NAMES).map(([v, l]) => ({ value: v, label: l }))} />
          </Field>
          <Field label={t('newProject.location', 'Location')}>
            <div className="flex items-center gap-2">
              <Input className="flex-1" value={parent} onChange={(e) => setParent(e.target.value)} />
              <Button
                variant="outline"
                size="icon"
                onClick={async () => {
                  const d = await window.api.openDir()
                  if (d) setParent(d)
                }}
              >
                <FolderOpen />
              </Button>
            </div>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={create} disabled={!name.trim() || busy}>
              {busy && <Loader2 className="animate-spin" />} {t('newProject.create', 'Create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
