import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Clapperboard, Copy, Download, Film, Loader2, Play, Sparkles, Wand2 } from 'lucide-react'
import type { Aspect, Episode } from '@shared/types'
import { totalDuration } from '@shared/ranges'
import { Button } from '@/components/ui/button'
import { Input, Select, Toggle } from '@/components/ui/controls'
import { projectsRoot, useProject } from '@/store/project'
import { useSettings } from '@/store/settings'
import { playerApi } from '@/store/ui'
import { exportEpisode, notify, planCreator, type CreatorItem, type CreatorMode } from '@/lib/pipeline'
import { cn, formatTime } from '@/lib/utils'

const fmt = (s: number) => formatTime(s).slice(s >= 3600 ? 0 : 3, 8)
const SUFFIX: Record<CreatorMode, string> = { shorts: 'Short', trailer: 'Trailer', recap: 'Recap' }
const DEFAULT_SEC: Record<CreatorMode, number> = { shorts: 45, trailer: 60, recap: 90 }

type Row = CreatorItem & { on: boolean }

/** AI Creator: shorts, trailer and recap videos from one episode, each with an AI title, description and hashtags. */
export function AiCreator({ ep }: { ep: Episode }) {
  const { t } = useTranslation()
  const dir = useProject((s) => s.dir)
  const burnDefault = useProject((s) => s.project?.settings.burnSubtitles ?? true)
  const [mode, setMode] = useState<CreatorMode>('shorts')
  const [count, setCount] = useState(5)
  const [seconds, setSeconds] = useState(DEFAULT_SEC.shorts)
  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<'plan' | 'export' | null>(null)
  const [progress, setProgress] = useState('')

  const pickMode = (m: CreatorMode) => {
    setMode(m)
    setSeconds(DEFAULT_SEC[m])
    setAspect(m === 'shorts' ? '9:16' : 'source')
    setRows([])
  }

  const plan = async () => {
    setBusy('plan')
    setRows([])
    try {
      const items = await planCreator(ep.id, mode, { count: mode === 'shorts' ? count : 1, seconds, note })
      setRows(items.map((it) => ({ ...it, on: true })))
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  const exportSelected = async () => {
    const chosen = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.on)
    if (!chosen.length) return
    setBusy('export')
    const root = dir ? `${dir}\\exports` : `${await projectsRoot()}\\exports`
    const outDir = `${root}\\${ep.label}\\${mode === 'shorts' ? 'shorts' : mode}`
    const files: string[] = []
    let failed = 0
    try {
      for (const [k, { r, i }] of chosen.entries()) {
        setProgress(t('creator.exporting', 'Exporting {{k}} of {{n}}…', { k: k + 1, n: chosen.length }))
        try {
          const out = await exportEpisode(
            {
              outDir,
              mp4: true,
              srt: true,
              vtt: false,
              ass: false,
              dubWav: false,
              instrumental: false,
              burn: burnDefault,
              applyEdit: true,
              // the dub mix is the same for every short: mix once, then reuse it
              remix: k === 0,
              originalAudio: false,
              cpu: false,
              resolution: useSettings.getState().exportResolution
            },
            ep.id,
            {
              clips: r.keep,
              aspect,
              suffix: mode === 'shorts' ? `${SUFFIX.shorts}${String(i + 1).padStart(2, '0')}` : SUFFIX[mode],
              meta: { title: r.title, description: r.description, hashtags: r.hashtags }
            }
          )
          files.push(...out.filter((f) => f.endsWith('.mp4')))
        } catch (e) {
          failed++
          notify(e)
        }
      }
      if (files.length) {
        toast.success(t('creator.done', '{{n}} videos exported (with title & hashtags .txt)', { n: files.length }), {
          action: { label: t('export.show', 'Show'), onClick: () => window.api.showInFolder(files[0]) }
        })
      } else if (failed) toast.error(t('creator.allFailed', 'No video could be exported'))
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const chosenCount = rows.filter((r) => r.on).length

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Film className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{t('creator.title', 'AI Creator')}</h3>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">{t('creator.subtitle', 'Shorts, trailer & recap from this episode')}</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap gap-1">
          <Toggle on={mode === 'shorts'} onClick={() => pickMode('shorts')}>
            <Sparkles /> {t('creator.shorts', 'Shorts')}
          </Toggle>
          <Toggle on={mode === 'trailer'} onClick={() => pickMode('trailer')}>
            <Clapperboard /> {t('creator.trailer', 'Trailer')}
          </Toggle>
          <Toggle on={mode === 'recap'} onClick={() => pickMode('recap')}>
            <Film /> {t('creator.recap', 'Recap')}
          </Toggle>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {mode === 'shorts' && (
            <Select
              value={String(count)}
              onChange={(v) => setCount(Number(v))}
              options={[3, 5, 8, 10].map((n) => ({ value: String(n), label: t('creator.count', '{{n}} shorts', { n }) }))}
              title={t('creator.howMany', 'How many')}
            />
          )}
          <Select
            value={String(seconds)}
            onChange={(v) => setSeconds(Number(v))}
            options={[15, 30, 45, 60, 90, 120].map((s) => ({ value: String(s), label: t('creator.sec', 'about {{s}} s', { s }) }))}
            title={t('creator.length', 'Length of each video')}
          />
          <Select
            value={aspect}
            onChange={(v) => setAspect(v as Aspect)}
            options={[
              { value: '9:16', label: '9:16 TikTok/Reels' },
              { value: '1:1', label: '1:1' },
              { value: '16:9', label: '16:9 YouTube' },
              { value: 'source', label: t('creator.sourceFormat', 'Same as video') }
            ]}
            title={t('creator.format', 'Format')}
          />
        </div>
        <Input
          placeholder={t('creator.notePh', 'Optional: what to focus on, e.g. “the fight scenes” or “the love story”')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && plan()}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={plan} disabled={!!busy || !ep.segments.length}>
            {busy === 'plan' ? <Loader2 className="animate-spin" /> : <Wand2 />}{' '}
            {mode === 'shorts' ? t('creator.planShorts', 'Find the best moments') : mode === 'trailer' ? t('creator.planTrailer', 'Make trailer') : t('creator.planRecap', 'Make recap')}
          </Button>
          {!ep.segments.length && <span className="text-xs text-warning">{t('creator.needLines', 'Make the lines first so the AI can read the story')}</span>}
        </div>

        {rows.length > 0 && (
          <div className="flex flex-col gap-2">
            {rows.map((r, i) => {
              const len = totalDuration(r.keep)
              return (
                <div key={i} className={cn('flex flex-col gap-1.5 rounded-md border p-2', r.on ? 'border-primary/40 bg-primary/5' : 'opacity-60')}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={r.on} onChange={() => set(i, { on: !r.on })} />
                    <span className="font-mono text-xs text-muted-foreground">#{i + 1}</span>
                    <Input className="h-7 flex-1 text-sm font-medium" value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
                    <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{fmt(len)}</span>
                    <Button size="icon" variant="ghost" className="size-7" title={t('creator.play', 'Play the first part')} onClick={() => playerApi()?.playRange(r.keep[0].start, r.keep[0].end)}>
                      <Play className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      title={t('creator.copy', 'Copy title, description & hashtags')}
                      onClick={() => {
                        void navigator.clipboard.writeText([r.title, '', r.description, '', r.hashtags.join(' ')].join('\n'))
                        toast.success(t('creator.copied', 'Copied'))
                      }}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                  {r.hook && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t('creator.hook', 'Hook')}: </span>
                      <b>{r.hook}</b>
                    </div>
                  )}
                  {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    <span className="text-primary">{r.hashtags.join(' ')}</span>
                    <span className="text-muted-foreground">·</span>
                    {r.keep.map((k, j) => (
                      <button key={j} className="font-mono text-muted-foreground hover:text-primary" onClick={() => playerApi()?.playRange(k.start, k.end)}>
                        {fmt(k.start)}–{fmt(k.end)}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={exportSelected} disabled={!!busy || !chosenCount}>
                {busy === 'export' ? <Loader2 className="animate-spin" /> : <Download />} {t('creator.export', 'Export {{n}} videos', { n: chosenCount })}
              </Button>
              <span className="text-xs text-muted-foreground">
                {progress || t('creator.exportHint', 'Each video gets its own .mp4, .srt and a .txt with the title, description and hashtags')}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
