import { useEffect, useState } from 'react'
import { useUi } from '@/store/ui'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, FolderOpen, Loader2, Play, ShieldAlert } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Progress, Select } from '@/components/ui/controls'
import { useSettings } from '@/store/settings'
import { outputSize, RESOLUTIONS } from '@shared/ranges'
import { planParts, SPLIT_MINUTES } from '@shared/split'
import { useActiveEpisode, useProject, projectsRoot } from '@/store/project'
import { useJobs } from '@/store/jobs'
import { editedDuration, exportEpisode, notify, type ExportOptions } from '@/lib/pipeline'
import { formatTime } from '@/lib/utils'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const dir = useProject((s) => s.dir)
  const burnDefault = useProject((s) => s.project?.settings.burnSubtitles ?? false)
  const source = useProject((s) => s.project?.source)
  const jobs = useJobs((s) => s.jobs)
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<string[] | null>(null)
  const [o, setO] = useState<ExportOptions>({
    outDir: '',
    mp4: true,
    srt: true,
    vtt: false,
    ass: false,
    dubWav: false,
    instrumental: false,
    burn: burnDefault,
    applyEdit: true,
    remix: true,
    originalAudio: false,
    cpu: false,
    resolution: useSettings.getState().exportResolution,
    splitMinutes: useSettings.getState().exportSplitMinutes,
    aiMeta: useSettings.getState().exportAiMeta
  })
  useEffect(() => {
    if (ep) {
      if (dir) {
        setO((x) => ({ ...x, outDir: `${dir}\\exports\\${ep.label}` }))
      } else {
        projectsRoot().then((root) => {
          setO((x) => (x.outDir ? x : { ...x, outDir: `${root}\\exports\\${ep.label}` }))
        }).catch(() => {})
      }
    }
  }, [dir, ep?.label])
  if (!ep) return null
  const voiced = ep.segments.filter((s) => s.audioPath).length
  const running = Object.values(jobs).filter((j) => j.episodeId === ep.id && (j.status === 'running' || j.status === 'queued'))
  const set = (p: Partial<ExportOptions>) => setO((x) => ({ ...x, ...p }))
  const outLen = ep.edit.enabled && o.applyEdit ? editedDuration(ep) : ep.durationSec
  const partsFor = (m: number) => (m ? planParts(outLen, m * 60).length + 1 : 1)

  const run = async () => {
    let outDir = o.outDir
    if (!outDir) {
      const d = await window.api.openDir()
      if (!d) return
      set({ outDir: d })
      outDir = d
    }
    setBusy(true)
    setFiles(null)
    try {
      setFiles(await exportEpisode({ ...o, outDir }, ep.id))
    } catch (e) {
      notify(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="w-[620px] p-6">
        <DialogTitle>
          {t('export.title', 'Export')} {ep.label}
        </DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {voiced
            ? t('export.voiced', '{{n}} dubbed lines will be mixed over the background.', { n: voiced })
            : ep.voiceTrack
              ? t('export.voiceTrack', 'The imported AI voice track will be mixed over the background.')
              : t('export.noVoices', 'No dub voices yet — the original audio will be used.')}{' '}
          {ep.edit.enabled && o.applyEdit && t('export.edited', 'Edited length: {{d}}', { d: formatTime(editedDuration(ep)).slice(0, 8) })}
          <span className="mt-1 block text-xs">
            {source
              ? `${t('export.source', 'Source')}: ${source.origin}${source.licence ? ` · ${source.licence}` : ''} — ${t('export.sourceSaved', 'saved as SOURCE.txt')}`
              : t('export.noSource', 'No source / licence noted for this project (Tools → Source & licence).')}
          </span>
        </DialogDescription>

        <div className="flex flex-col gap-4">
          <Field label={t('export.folder', 'Output folder')}>
            <div className="flex gap-2">
              <Input className="flex-1" value={o.outDir} onChange={(e) => set({ outDir: e.target.value })} />
              <Button
                variant="outline"
                size="icon"
                onClick={async () => {
                  const d = await window.api.openDir()
                  if (d) set({ outDir: d })
                }}
              >
                <FolderOpen />
              </Button>
            </div>
          </Field>
          <Field label={t('export.resolution', 'Resolution')}>
            <Select
              className="w-full"
              disabled={!o.mp4}
              value={String(o.resolution ?? 0)}
              onChange={(v) => {
                set({ resolution: Number(v) })
                useSettings.getState().set({ exportResolution: Number(v) })
              }}
              options={RESOLUTIONS.map((r) => {
                const vw = ep.media?.video?.width ?? 0
                const vh = ep.media?.video?.height ?? 0
                const aspect = ep.edit.enabled && o.applyEdit ? ep.edit.aspect : 'source'
                const sz = outputSize(aspect, vw, vh, r || undefined)
                const name = r === 0 ? t('export.resOriginal', 'Original') : r === 2160 ? '2160p (4K)' : `${r}p`
                const up = r > 0 && vw && vh && r > Math.min(vw, vh) ? ` — ${t('export.upscale', 'upscaled')}` : ''
                return { value: String(r), label: `${name}  ·  ${sz.w}×${sz.h}${up}` }
              })}
            />
          </Field>
          <Field
            label={t('export.split', 'Split into episodes')}
            hint={
              o.splitMinutes && partsFor(o.splitMinutes) > 1
                ? t('export.splitHint', '{{n}} videos ("… EP01", "… EP02"…), each with its own subtitles. Cuts fall between subtitle lines.', { n: partsFor(o.splitMinutes) })
                : undefined
            }
          >
            <Select
              className="w-full"
              value={String(o.splitMinutes ?? 0)}
              onChange={(v) => {
                set({ splitMinutes: Number(v) })
                useSettings.getState().set({ exportSplitMinutes: Number(v) })
              }}
              options={SPLIT_MINUTES.map((m) => {
                if (m === 0) return { value: '0', label: t('export.splitFull', 'Full video (no split)') }
                const n = partsFor(m)
                const parts = n > 1 ? t('export.splitParts', '{{n}} parts', { n }) : t('export.splitShort', 'shorter than this — stays 1 video')
                return { value: String(m), label: `${t('export.splitEvery', 'Every {{m}} minutes', { m })}  ·  ${parts}` }
              })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <Checkbox checked={o.mp4} onChange={(v) => set({ mp4: v })} label={t('export.mp4', 'Dubbed MP4 video')} />
            <Checkbox checked={o.burn} onChange={(v) => set({ burn: v })} label={t('export.burn', 'Burn styled captions')} />
            <Checkbox checked={o.srt} onChange={(v) => set({ srt: v })} label="SRT" />
            <Checkbox checked={o.vtt} onChange={(v) => set({ vtt: v })} label="WebVTT" />
            <Checkbox checked={o.ass} onChange={(v) => set({ ass: v })} label={t('export.ass', 'ASS (styled subtitles)')} />
            <Checkbox checked={o.dubWav} onChange={(v) => set({ dubWav: v })} label={t('export.dubWav', 'Dub voice only (WAV)')} />
            <Checkbox checked={o.instrumental} onChange={(v) => set({ instrumental: v })} label={t('export.instrumental', 'Instrumental stem (WAV)')} />
            {ep.edit.enabled && <Checkbox checked={o.applyEdit} onChange={(v) => set({ applyEdit: v })} label={t('export.applyEdit', 'Apply AI editor cuts & format')} />}
            <Checkbox checked={o.remix} onChange={(v) => set({ remix: v })} label={t('export.remix', 'Re-mix audio before export')} />
            <Checkbox checked={o.originalAudio} onChange={(v) => set({ originalAudio: v })} label={t('export.original', 'Keep original audio (no dub)')} />
            <Checkbox checked={o.cpu} onChange={(v) => set({ cpu: v })} label={t('export.cpu', 'Use CPU encoder (slower)')} />
            <Checkbox
              checked={!!o.aiMeta}
              onChange={(v) => {
                set({ aiMeta: v })
                useSettings.getState().set({ exportAiMeta: v })
              }}
              label={t('export.aiMeta', 'AI title, description & hashtags (.txt)')}
            />
          </div>

          {running.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border p-3">
              {running.map((j) => (
                <div key={j.id} className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs">
                    <span>{j.message || j.label}</span>
                    <span className="font-mono">{Math.round(j.progress)}%</span>
                  </div>
                  <Progress value={j.progress} />
                </div>
              ))}
            </div>
          )}

          {files && (
            <div className="flex flex-col gap-1 rounded-md border border-success/40 bg-success/5 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="size-4" /> {t('export.done', 'Export finished')}
              </div>
              {files.map((f) => (
                <div key={f} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate" title={f}>
                    {f.split(/[\\/]/).pop()}
                  </span>
                  {f.endsWith('.mp4') && (
                    <button className="text-primary hover:underline" onClick={() => window.api.openPath(f)}>
                      <Play className="inline size-3" />
                    </button>
                  )}
                  <button className="text-primary hover:underline" onClick={() => window.api.showInFolder(f)}>
                    {t('export.show', 'Show')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" className="mr-auto" disabled={busy || !ep.videoPath} onClick={() => useUi.getState().set({ dialog: 'copyright' })} title={t('export.crHint', 'Is anything likely to be claimed, muted or blocked on YouTube / Facebook / TikTok?')}>
              <ShieldAlert /> {t('export.cr', 'Check copyright first')}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('common.close', 'Close')}
            </Button>
            <Button onClick={run} disabled={busy || !ep.videoPath}>
              {busy && <Loader2 className="animate-spin" />} {t('export.run', 'Export')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
