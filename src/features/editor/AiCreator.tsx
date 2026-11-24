import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Clapperboard, Copy, Download, Film, ImageIcon, Layers, Loader2, Play, Rocket, Sparkles, Wand2 } from 'lucide-react'
import type { Aspect, Episode } from '@shared/types'
import { totalDuration } from '@shared/ranges'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select, Toggle } from '@/components/ui/controls'
import { useProject } from '@/store/project'
import { playerApi } from '@/store/ui'
import { exportCreatorItems, generateCreatorVideos, notify, planCreator, type CreatorItem, type CreatorMode } from '@/lib/pipeline'
import { cn, formatTime } from '@/lib/utils'
import { ThumbnailMaker, type ThumbTarget } from './ThumbnailMaker'

const fmt = (s: number) => formatTime(s).slice(s >= 3600 ? 0 : 3, 8)
const DEFAULT_SEC: Record<CreatorMode, number> = { shorts: 45, trailer: 60, recap: 90 }

type Row = CreatorItem & { on: boolean }

/** AI Creator: shorts, trailer and recap videos from one episode, each with an AI title, description and hashtags. */
export function AiCreator({ ep }: { ep: Episode }) {
  const { t } = useTranslation()
  // select the (stable) episodes array, derive the ids — a new array from the selector would re-render forever
  const episodes = useProject((s) => s.project?.episodes)
  const readyEps = useMemo(() => (episodes ?? []).filter((e) => e.videoPath && e.segments.length).map((e) => e.id), [episodes])
  const [showHook, setShowHook] = useState(true)
  const [mode, setMode] = useState<CreatorMode>('shorts')
  // the Thumbnail tab (and which short it is for)
  const [thumbTab, setThumbTab] = useState(false)
  const [thumbFor, setThumbFor] = useState<ThumbTarget | null>(null)
  const [count, setCount] = useState(5)
  const [seconds, setSeconds] = useState(DEFAULT_SEC.shorts)
  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<'plan' | 'export' | 'generate' | null>(null)
  const [progress, setProgress] = useState('')

  const pickMode = (m: CreatorMode) => {
    setThumbTab(false)
    // back from the Thumbnail tab to the same mode: keep the AI picks
    if (m === mode) return
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

  const done = (files: string[], failed: number) => {
    if (files.length) {
      toast.success(t('creator.done', '{{n}} videos exported (with title & hashtags .txt)', { n: files.length }), {
        action: { label: t('export.show', 'Show'), onClick: () => window.api.showInFolder(files[0]) }
      })
    } else if (failed) toast.error(t('creator.allFailed', 'No video could be exported'))
  }

  const exportSelected = async () => {
    const chosen = rows.map((r, index) => ({ item: r as CreatorItem, index, on: r.on })).filter((x) => x.on)
    if (!chosen.length) return
    setBusy('export')
    try {
      const r = await exportCreatorItems(ep.id, mode, chosen, { aspect, showHook }, (k, n) =>
        setProgress(t('creator.exporting', 'Exporting {{k}} of {{n}}…', { k: Math.min(k + 1, n), n }))
      )
      done(r.files, r.failed)
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  /** One click: plan + export, for this episode or all episodes. */
  const generate = async (ids: string[]) => {
    if (ids.length > 1 && !confirm(t('creator.allConfirm', 'Make {{what}} for all {{n}} episodes and export them? This uses the AI and takes a while.', { what: mode === 'shorts' ? t('creator.count', '{{n}} shorts', { n: count }) : mode === 'trailer' ? t('creator.trailer', 'Trailer') : t('creator.recap', 'Recap'), n: ids.length })))
      return
    setBusy('generate')
    setRows([])
    try {
      const r = await generateCreatorVideos(ids, mode, { count: mode === 'shorts' ? count : 1, seconds, aspect, showHook, note }, setProgress)
      done(r.files, r.failed)
      if (r.skipped.length) toast.info(t('editor.allSkipped', 'Skipped (no video or lines yet): {{list}}', { list: r.skipped.join(', ') }))
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const chosenCount = rows.filter((r) => r.on).length

  return (
    <section id="ai-creator" className="scroll-mt-3 rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Film className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{t('creator.title', 'AI Creator')}</h3>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">{t('creator.subtitle', 'Shorts, trailer & recap from this episode')}</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap gap-1">
          <Toggle on={!thumbTab && mode === 'shorts'} onClick={() => pickMode('shorts')}>
            <Sparkles /> {t('creator.shorts', 'Shorts')}
          </Toggle>
          <Toggle on={!thumbTab && mode === 'trailer'} onClick={() => pickMode('trailer')}>
            <Clapperboard /> {t('creator.trailer', 'Trailer')}
          </Toggle>
          <Toggle on={!thumbTab && mode === 'recap'} onClick={() => pickMode('recap')}>
            <Film /> {t('creator.recap', 'Recap')}
          </Toggle>
          <Toggle on={thumbTab} onClick={() => (setThumbTab(true), setThumbFor(null))}>
            <ImageIcon /> {t('creator.thumbnail', 'Thumbnail')}
          </Toggle>
        </div>

        {thumbTab ? (
          <ThumbnailMaker ep={ep} target={thumbFor} onClearTarget={() => setThumbFor(null)} />
        ) : (
        <>

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
        <Checkbox checked={showHook} onChange={setShowHook} label={t('creator.showHook', 'Show the hook on screen (first 3 s)')} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => generate([ep.id])} disabled={!!busy || !ep.segments.length} title={t('creator.generateHint', 'The AI picks the moments and the videos are exported straight away')}>
            {busy === 'generate' ? <Loader2 className="animate-spin" /> : <Rocket />} {t('creator.generate', 'Generate videos')}
          </Button>
          {readyEps.length > 1 && (
            <Button size="sm" variant="outline" onClick={() => generate(readyEps)} disabled={!!busy}>
              <Layers /> {t('creator.generateAll', 'All {{n}} episodes', { n: readyEps.length })}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={plan} disabled={!!busy || !ep.segments.length} title={t('creator.reviewHint', 'See the AI picks first, then choose what to export')}>
            {busy === 'plan' ? <Loader2 className="animate-spin" /> : <Wand2 />}{' '}
            {mode === 'shorts' ? t('creator.planShorts', 'Find the best moments') : mode === 'trailer' ? t('creator.planTrailer', 'Make trailer') : t('creator.planRecap', 'Make recap')}
          </Button>
          {!ep.segments.length && <span className="text-xs text-warning">{t('creator.needLines', 'Make the lines first so the AI can read the story')}</span>}
        </div>
        {busy === 'generate' && progress && <div className="text-xs text-muted-foreground">{progress}</div>}

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
                      title={t('creator.makeThumb', 'Make a thumbnail for this video')}
                      onClick={() => {
                        setThumbFor({ label: `#${i + 1} ${r.title}`, title: r.hook || r.title, keep: r.keep, aspect: aspect === '9:16' ? '9:16' : '16:9' })
                        setThumbTab(true)
                      }}
                    >
                      <ImageIcon className="size-3.5" />
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
        </>
        )}
      </div>
    </section>
  )
}
