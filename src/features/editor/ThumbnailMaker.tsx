import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Film, FolderOpen, ImageIcon, Loader2, Sparkles, Wand2, X } from 'lucide-react'
import type { Episode } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input, Select, Toggle } from '@/components/ui/controls'
import { useMediaUrl } from '@/lib/hooks'
import { makeThumbnails, notify, planThumbnail, type ThumbMode } from '@/lib/pipeline'
import { cn } from '@/lib/utils'

export interface ThumbTarget {
  /** label shown above the form, e.g. "Short #2" */
  label: string
  title: string
  keep: Array<{ start: number; end: number }>
  aspect: '16:9' | '9:16'
}

const COLORS = ['#FFD400', '#FFFFFF', '#FF3B30', '#22D3EE', '#4ADE80']

/** AI Thumbnail: a cover picture for the episode (or one short), with the title burned in. */
export function ThumbnailMaker({ ep, target, onClearTarget }: { ep: Episode; target?: ThumbTarget | null; onClearTarget?: () => void }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<ThumbMode>('ai')
  const [aspect, setAspect] = useState<'16:9' | '9:16'>('16:9')
  const [count, setCount] = useState(2)
  const [title, setTitle] = useState('')
  const [tag, setTag] = useState(ep.label)
  const [color, setColor] = useState(COLORS[0])
  const [note, setNote] = useState('')
  const [plan, setPlan] = useState<{ moments: number[]; scene: string } | null>(null)
  const [busy, setBusy] = useState<'title' | 'make' | null>(null)
  const [files, setFiles] = useState<string[]>([])

  // a short / trailer picked in the list: its title, its moments, its format
  useEffect(() => {
    setPlan(null)
    if (target) {
      setTitle(target.title)
      setAspect(target.aspect)
    }
  }, [target])
  useEffect(() => setTag(ep.label), [ep.label])

  const writeTitle = async () => {
    setBusy('title')
    try {
      const r = await planThumbnail(ep.id, { note, keep: target?.keep })
      setTitle(r.title)
      setPlan({ moments: r.moments, scene: r.scene })
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  const make = async () => {
    setBusy('make')
    try {
      let p = plan
      let tt = title
      // no title yet: the AI writes it together with the moments
      if (!p && ep.segments.length) {
        const r = await planThumbnail(ep.id, { note, keep: target?.keep })
        p = { moments: r.moments, scene: r.scene }
        setPlan(p)
        if (!tt.trim()) setTitle((tt = r.title))
      }
      const r = await makeThumbnails(ep.id, { mode, aspect, count, title: tt, tag, color, note, keep: target?.keep, plan: p ?? undefined })
      setFiles(r.files)
      toast.success(t('thumb.done', '{{n}} thumbnails saved', { n: r.files.length }), {
        action: { label: t('export.show', 'Show'), onClick: () => window.api.showInFolder(r.files[0]) }
      })
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {target && (
        <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-xs">
          <Film className="size-3.5 text-primary" />
          <span>
            {t('thumb.for', 'Thumbnail for')} <b>{target.label}</b>
          </span>
          <div className="flex-1" />
          <button className="text-muted-foreground hover:text-foreground" title={t('thumb.wholeEp', 'Use the whole episode')} onClick={onClearTarget}>
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <Toggle on={mode === 'ai'} onClick={() => setMode('ai')} title={t('thumb.aiHint', 'Gemini repaints the best moments into a poster (needs a Gemini key with billing)')}>
          <Sparkles /> {t('thumb.ai', 'AI picture (Gemini)')}
        </Toggle>
        <Toggle on={mode === 'frame'} onClick={() => setMode('frame')} title={t('thumb.frameHint', 'Uses the best moment from the video itself — free')}>
          <ImageIcon /> {t('thumb.frame', 'Video frame (free)')}
        </Toggle>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Select
          value={aspect}
          onChange={(v) => setAspect(v as '16:9' | '9:16')}
          options={[
            { value: '16:9', label: '16:9 YouTube' },
            { value: '9:16', label: '9:16 TikTok/Reels' }
          ]}
          title={t('creator.format', 'Format')}
        />
        <Select value={String(count)} onChange={(v) => setCount(Number(v))} options={[1, 2, 4].map((n) => ({ value: String(n), label: t('thumb.count', '{{n}} pictures', { n }) }))} title={t('creator.howMany', 'How many')} />
        <div className="flex items-center gap-1" title={t('thumb.color', 'Title colour')}>
          {COLORS.map((c) => (
            <button
              key={c}
              className={cn('size-6 rounded-full border-2', color === c ? 'border-primary ring-2 ring-primary/40' : 'border-border')}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <Input className="flex-1 font-semibold" placeholder={t('thumb.titlePh', 'Title on the picture (empty = the AI writes it)')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input className="w-24" placeholder={t('thumb.tagPh', 'EP 01')} value={tag} onChange={(e) => setTag(e.target.value)} title={t('thumb.tag', 'Small label in the corner')} />
        <Button size="sm" variant="outline" onClick={writeTitle} disabled={!!busy || !ep.segments.length} title={t('thumb.writeHint', 'The AI reads the story and writes a catchy title')}>
          {busy === 'title' ? <Loader2 className="animate-spin" /> : <Wand2 />} {t('thumb.write', 'Write title')}
        </Button>
      </div>
      <Input placeholder={t('thumb.notePh', 'Optional: what to show, e.g. “the slap scene” or “the couple crying in the rain”')} value={note} onChange={(e) => (setNote(e.target.value), setPlan(null))} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={make} disabled={!!busy || !ep.videoPath}>
          {busy === 'make' ? <Loader2 className="animate-spin" /> : <ImageIcon />} {t('thumb.make', 'Make thumbnails')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {mode === 'ai' ? t('thumb.aiNote', 'Gemini image model · about $0.04–0.15 per picture on a paid key') : t('thumb.frameNote', 'Free · works offline')}
        </span>
      </div>
      {files.length > 0 && (
        <div className={cn('grid gap-2', aspect === '9:16' ? 'grid-cols-4' : 'grid-cols-2')}>
          {files.map((f) => (
            <ThumbView key={f} path={f} />
          ))}
        </div>
      )}
    </div>
  )
}

function ThumbView({ path }: { path: string }) {
  const { t } = useTranslation()
  const url = useMediaUrl(path, path)
  return (
    <div className="group relative overflow-hidden rounded-md border bg-muted">
      {url && <img src={url} className="w-full cursor-zoom-in object-cover" onClick={() => void window.api.openPath(path)} title={t('thumb.open', 'Open')} />}
      <Button size="icon" variant="secondary" className="absolute right-1 top-1 size-7 opacity-0 group-hover:opacity-100" title={t('export.show', 'Show')} onClick={() => window.api.showInFolder(path)}>
        <FolderOpen className="size-3.5" />
      </Button>
    </div>
  )
}
