import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AudioWaveform, Bot, Captions, EyeOff, FileDown, FileUp, Film, FlipHorizontal2, FolderInput, Link, Loader2, Megaphone, Music, ShieldCheck, Stamp, Video, VolumeX, Wand2, type LucideIcon } from 'lucide-react'
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
  const hasCover = useProject((s) => !!s.project?.settings.subCover?.enabled)
  const flipped = useProject((s) => !!s.project?.settings.flip?.h)
  const hasAds = useProject((s) => !!(s.project?.settings.ads?.videos.some((v) => v.enabled) || s.project?.settings.ads?.banners.some((b) => b.enabled)))
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
    {
      key: 'aiVideo',
      icon: Film,
      label: t('tools.aiVideo', 'AI Video'),
      // always clickable: without a video the editor explains what AI Video needs and offers the imports
      run: () => {
        // open the AI Video Editor tab at the AI Creator (shorts / trailer / recap)
        setUi({ centerTab: 'editor' })
        setTimeout(() => document.getElementById('ai-creator')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
      }
    },
    { key: 'importFolder', icon: FolderInput, label: t('tools.importFolder', 'Import Folder'), run: () => importFolder() },
    { key: 'importLink', icon: Link, label: t('tools.importLink', 'Import Link'), run: () => setUi({ dialog: 'link' }) },
    { key: 'subCover', icon: EyeOff, label: t('tools.subCover', 'Hide Old Subs'), active: hasCover, needsVideo: true, run: () => setUi({ dialog: 'subcover' }) },
    { key: 'watermark', icon: Stamp, label: t('tools.watermark', 'Watermark'), active: hasWm, run: () => setUi({ dialog: 'watermark' }) },
    { key: 'ads', icon: Megaphone, label: t('tools.ads', 'Ads'), active: hasAds, run: () => setUi({ dialog: 'ads' }) },
    {
      key: 'flip',
      icon: FlipHorizontal2,
      label: t('tools.flip', 'Flip'),
      active: flipped,
      needsVideo: true,
      run: () => {
        mutate((p) => ({ ...p, settings: { ...p.settings, flip: flipped ? undefined : { h: true } } }))
        toast.info(flipped ? t('tools.flipOff', 'Picture back to normal') : t('tools.flipOn', 'Picture mirrored (left ↔ right) — in the preview and the export. Captions stay readable.'))
      }
    },
    { key: 'source', icon: ShieldCheck, label: t('tools.source', 'Source & licence'), active: hasSource, run: () => setUi({ dialog: 'source' }) }
  ]

  const cls = (active?: boolean) => cn('ribbon-btn relative', active && 'after:absolute after:bottom-0.5 after:h-0.5 after:w-5 after:rounded-full after:bg-primary')

  // one row of icon tools across the top of the workspace (scrolls sideways on small windows)
  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:thin]">
      {tools.map(({ key, icon: Icon, label, run, active, needsVideo, menu }) => {
        const disabled = !!busy || (needsVideo && !ep?.videoPath)
        const icon = busy === key ? <Loader2 className="size-[18px] animate-spin" /> : <Icon className="size-[18px]" strokeWidth={1.8} />
        if (menu)
          return (
            <DropdownMenu key={key}>
              <DropdownTrigger asChild>
                <button className={cls(active)} data-active={!!active} disabled={disabled} title={label}>
                  {icon}
                  <span className="line-clamp-1 w-full truncate text-center">{label}</span>
                </button>
              </DropdownTrigger>
              <DropdownContent>{menu}</DropdownContent>
            </DropdownMenu>
          )
        return (
          <button key={key} disabled={disabled} onClick={run && wrap(key, run)} className={cls(active)} data-active={!!active} title={label}>
            {icon}
            <span className="line-clamp-1 w-full truncate text-center">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
