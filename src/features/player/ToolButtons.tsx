import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AudioWaveform, Bot, Captions, FileDown, FileUp, FolderInput, Link, Loader2, Music, ShieldCheck, Stamp, Video, VolumeX, Wand2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mutate, useActiveEpisode, useProject } from '@/store/project'
import { useUi } from '@/store/ui'
import { importBgm, importFolder, saveSrtFiles, importSubtitles, importVideo, importVoiceTrack, notify, separateVocals } from '@/lib/pipeline'
import { DropdownContent, DropdownMenu, DropdownTrigger } from '@/components/ui/controls'
import { setBurnSubtitles } from './burn'

interface Tool {
  key: string
  icon: LucideIcon
  label: string
  run?: () => Promise<unknown> | void
  active?: boolean
  needsVideo?: boolean
  menu?: React.ReactNode
}

export function ToolButtons() {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const muteOriginal = useProject((s) => s.project?.settings.muteOriginal ?? false)
  const burn = useProject((s) => s.project?.settings.burnSubtitles ?? false)
  const hasSource = useProject((s) => !!s.project?.source)
  const hasWm = useProject((s) => !!s.project?.settings.watermark)
  const setUi = useUi((s) => s.set)
  const [busy, setBusy] = useState<string | null>(null)

  const wrap = (key: string, fn: () => Promise<unknown> | void) => async () => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  const tools: Tool[] = [
    { key: 'importVideo', icon: Video, label: t('tools.importVideo', 'Import Video'), run: () => importVideo(), active: !ep?.videoPath },
    { key: 'importBgm', icon: Music, label: t('tools.importBgm', 'Import BGM'), run: () => importBgm(), active: !!ep?.edit.bgm },
    { key: 'importAiVoice', icon: AudioWaveform, label: t('tools.importAiVoice', 'Import AI Voice'), run: () => importVoiceTrack(), active: !!ep?.voiceTrack },
    { key: 'separateVocals', icon: Wand2, label: t('tools.separateVocals', 'Remove BGM'), run: () => separateVocals(), active: !!ep?.stems.instrumental, needsVideo: true },
    {
      key: 'muteOriginal',
      icon: VolumeX,
      label: t('tools.muteOriginal', 'Mute Original'),
      active: muteOriginal,
      run: () => {
        mutate((p) => ({ ...p, settings: { ...p.settings, muteOriginal: !p.settings.muteOriginal } }), { undo: false })
        toast.info(
          !muteOriginal
            ? t('tools.mutedOn2', 'Original audio OFF — muted in the preview and the export (only dub voices / BGM are heard)')
            : t('tools.mutedOff', 'Original/instrumental audio is back in the mix')
        )
      }
    },
    {
      key: 'exportSrt',
      icon: FileDown,
      label: t('tools.exportSrt', 'Export SRT'),
      run: () => saveSrtFiles()
    },
    { key: 'importSrt', icon: FileUp, label: t('tools.importSrt', 'Import SRT/VTT'), run: () => importSubtitles() },
    {
      key: 'burnSubtitles',
      icon: Captions,
      label: t('tools.burnSubtitles', 'Burn Subtitles'),
      active: burn,
      run: () => setBurnSubtitles(!burn)
    },
    { key: 'automate', icon: Bot, label: t('tools.automate', 'Automate'), run: () => setUi({ dialog: 'automate' }) },
    { key: 'importFolder', icon: FolderInput, label: t('tools.importFolder', 'Import Folder'), run: () => importFolder() },
    { key: 'importLink', icon: Link, label: t('tools.importLink', 'Import Link'), run: () => setUi({ dialog: 'link' }) },
    { key: 'watermark', icon: Stamp, label: t('tools.watermark', 'Watermark'), active: hasWm, run: () => setUi({ dialog: 'watermark' }) },
    { key: 'source', icon: ShieldCheck, label: t('tools.source', 'Source & licence'), active: hasSource, run: () => setUi({ dialog: 'source' }) }
  ]

  const cls = (active?: boolean) =>
    cn(
      'flex h-16 w-full flex-col items-center justify-center gap-1 rounded-md border px-1 text-xs transition-colors',
      'hover:border-primary/60 hover:bg-accent disabled:pointer-events-none disabled:opacity-40',
      active && 'border-primary/50 bg-primary/10 text-primary'
    )

  return (
    <div className="grid grid-cols-3 gap-2">
      {tools.map(({ key, icon: Icon, label, run, active, needsVideo, menu }) => {
        const disabled = !!busy || (needsVideo && !ep?.videoPath)
        const icon = busy === key ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />
        if (menu)
          return (
            <DropdownMenu key={key}>
              <DropdownTrigger asChild>
                <button className={cls(active)} disabled={disabled} title={label}>
                  {icon}
                  <span className="line-clamp-1 leading-tight">{label}</span>
                </button>
              </DropdownTrigger>
              <DropdownContent>{menu}</DropdownContent>
            </DropdownMenu>
          )
        return (
          <button key={key} disabled={disabled} onClick={run && wrap(key, run)} className={cls(active)} title={label}>
            {icon}
            <span className="line-clamp-1 leading-tight">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
