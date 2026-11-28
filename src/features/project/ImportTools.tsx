import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, FileVideo, Loader2, ShieldCheck } from 'lucide-react'
import type { ProjectSource } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select } from '@/components/ui/controls'
import { mutate, useProject } from '@/store/project'
import { importLink, notify, type LinkQuality } from '@/lib/pipeline'
import { post } from '@/lib/api'
import { formatTime } from '@/lib/utils'

type LinkInfo =
  | { type: 'file'; kind: 'direct' | 'gdrive' | 'dropbox' | 'dropbox-folder' | 'onedrive' | 'mega'; title?: string }
  | { type: 'video'; title: string; thumbnail: string | null; duration: number | null; uploader: string | null; site: string | null; heights: number[]; isLive: boolean }
  | {
      type: 'playlist'
      title: string
      uploader: string | null
      site: string | null
      thumbnail: string | null
      count: number
      truncated: boolean
      entries: Array<{ index: number; title: string; url: string; duration: number | null; thumbnail: string | null }>
    }

const isUrl = (s: string) => /^https?:\/\/\S+\.\S+/i.test(s.trim())
const QUALITY_LS = 'kd.linkQuality'

/**
 * Import Link (VidGrab flow): paste a link → the preview loads by itself → pick a quality (and the videos of a
 * playlist) → Download. The dialog closes right away; downloads run in the jobs panel and each finished video
 * becomes the next episode.
 */
export function LinkDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [wholeList, setWholeList] = useState(false)
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [quality, setQualityState] = useState<LinkQuality>(() => {
    try {
      return (localStorage.getItem(QUALITY_LS) as LinkQuality) || '1080'
    } catch {
      return '1080'
    }
  })
  const setQuality = (q: LinkQuality) => {
    setQualityState(q)
    try {
      localStorage.setItem(QUALITY_LS, q)
    } catch {
      /* ignore */
    }
  }
  const hasList = /[?&]list=/.test(url)
  const seq = useRef(0)

  // fetch the preview automatically shortly after a link is pasted / typed
  useEffect(() => {
    const u = url.trim()
    setInfo(null)
    setError(null)
    if (!isUrl(u)) return
    const my = ++seq.current
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await post<LinkInfo>('/link/info', { url: u, playlist: wholeList })
        if (my !== seq.current) return
        setInfo(r)
        if (r.type === 'playlist') setPicked(new Set(r.entries.map((e) => e.url)))
      } catch (e) {
        if (my === seq.current) setError((e as Error).message)
      } finally {
        if (my === seq.current) setLoading(false)
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [url, wholeList])

  const urls = info?.type === 'playlist' ? info.entries.filter((e) => picked.has(e.url)).map((e) => e.url) : [url.trim()]
  const canGo = !!info && !loading && urls.length > 0 && !(info.type === 'video' && info.isLive)

  const go = () => {
    if (!canGo) return
    // run in the background: progress shows in the jobs panel, episodes appear as downloads finish
    void importLink(urls, quality).catch(notify)
    toast.info(
      urls.length > 1
        ? t('link.started', 'Downloading {{n}} videos — they become episodes in order as they finish', { n: urls.length })
        : t('link.startedOne', 'Downloading — it becomes a new episode when it finishes')
    )
    onClose()
  }

  const qualities: Array<{ value: LinkQuality; label: string }> = [
    { value: 'best', label: t('link.qBest', 'Best available') },
    { value: '1080', label: '1080p' },
    { value: '720', label: '720p' },
    { value: '480', label: '480p' }
  ]
  const maxH = info?.type === 'video' ? info.heights[0] : undefined

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[600px] p-6">
        <DialogTitle>{t('link.title', 'Import from link')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t(
            'link.desc3',
            'Paste a link to a video you own or are licensed to dub: a video page (YouTube, Facebook, TikTok… — your own uploads), a playlist, a direct video file, or a share link from Google Drive, Dropbox, OneDrive or MEGA — a single file or a whole shared folder (episodes are put in order). Copy-protected streaming / VIP services and unlicensed drama sites are not supported.'
          )}
        </DialogDescription>
        <Field label={t('link.url', 'Link')}>
          <div className="relative">
            <Input
              autoFocus
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              className="pr-8"
            />
            {loading && <Loader2 className="absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
        </Field>
        {hasList && (
          <div className="mt-2">
            <Checkbox checked={wholeList} onChange={setWholeList} label={t('link.wholeList', 'Download the whole playlist (each video becomes an episode)')} />
          </div>
        )}

        {error && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

        {info?.type === 'file' && (
          <div className="mt-3 flex items-center gap-2 rounded-md border p-3 text-sm">
            <FileVideo className="size-5 text-primary" />
            {info.kind === 'gdrive'
              ? t('link.gdrive', 'Google Drive file')
              : info.kind === 'dropbox'
                ? t('link.dropbox', 'Dropbox file')
                : info.kind === 'dropbox-folder'
                  ? t('link.dropboxFolder', 'Dropbox folder — every video in it, in episode order')
                  : info.kind === 'onedrive'
                    ? `${t('link.onedrive', 'OneDrive file')}${info.title ? `: ${info.title}` : ''}`
                    : info.kind === 'mega'
                      ? `${t('link.mega', 'MEGA file')}${info.title ? `: ${info.title}` : ''}`
                      : t('link.direct', 'Direct video file')}
            <span className="text-muted-foreground">— {t('link.asIs', 'downloaded as is')}</span>
          </div>
        )}

        {info?.type === 'video' && (
          <div className="mt-3 flex gap-3 rounded-md border p-3">
            {info.thumbnail ? (
              <img src={info.thumbnail} alt="" className="h-20 w-36 shrink-0 rounded object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="grid h-20 w-36 shrink-0 place-items-center rounded bg-muted">
                <FileVideo className="size-6 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <div className="line-clamp-2 font-medium">{info.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {[info.site, info.uploader, info.duration != null ? formatTime(info.duration) : null, maxH ? `${t('link.upTo', 'up to')} ${maxH}p` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {info.isLive && <div className="mt-1 text-xs text-destructive">{t('link.live', 'Live streams cannot be imported')}</div>}
            </div>
          </div>
        )}

        {info?.type === 'playlist' && (
          <div className="mt-3 rounded-md border">
            <div className="flex items-center justify-between gap-2 border-b p-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{info.title}</div>
                <div className="text-xs text-muted-foreground">
                  {[info.site, info.uploader, `${info.entries.length} ${t('link.videos', 'videos')}${info.truncated ? '+' : ''}`].filter(Boolean).join(' · ')}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPicked(picked.size === info.entries.length ? new Set() : new Set(info.entries.map((e) => e.url)))}
              >
                {picked.size === info.entries.length ? t('link.none', 'Select none') : t('link.all', 'Select all')}
              </Button>
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {info.entries.map((e) => (
                <label key={e.url} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={picked.has(e.url)}
                    onChange={() => {
                      const n = new Set(picked)
                      if (n.has(e.url)) n.delete(e.url)
                      else n.add(e.url)
                      setPicked(n)
                    }}
                  />
                  <span className="w-8 shrink-0 text-right font-mono text-xs text-muted-foreground">{e.index}</span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  {e.duration != null && <span className="font-mono text-xs text-muted-foreground">{formatTime(e.duration)}</span>}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {info && info.type !== 'file' && (
            <Select
              className="mr-auto w-40"
              value={quality}
              onChange={(v) => setQuality(v as LinkQuality)}
              options={qualities}
              title={t('link.quality', 'Quality')}
            />
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={go} disabled={!canGo}>
            <Download />
            {urls.length > 1 ? t('link.downloadN', 'Download {{n}} & add episodes', { n: urls.length }) : t('link.download', 'Download & add episode')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Where the episodes come from and the permission to dub them; saved with the project and next to every export. */
export function SourceDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const cur = useProject((s) => s.project?.source)
  const [v, setV] = useState<ProjectSource>({ origin: cur?.origin ?? '', licence: cur?.licence ?? '', notes: cur?.notes ?? '' })
  const save = () => {
    const empty = !v.origin.trim() && !v.licence.trim() && !v.notes?.trim()
    mutate((p) => ({ ...p, source: empty ? undefined : { origin: v.origin.trim(), licence: v.licence.trim(), notes: v.notes?.trim() || undefined } }))
    onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[560px] p-6">
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" /> {t('source.title', 'Source & licence')}
        </DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t('source.desc', 'Keep a record of where these episodes come from and your permission to dub them. It is saved as SOURCE.txt next to every export.')}
        </DialogDescription>
        <div className="flex flex-col gap-3">
          <Field label={t('source.origin', 'Source')}>
            <Input placeholder={t('source.originPh', 'e.g. Distributor / rights holder, original title')} value={v.origin} onChange={(e) => setV({ ...v, origin: e.target.value })} />
          </Field>
          <Field label={t('source.licence', 'Licence / permission')}>
            <Input placeholder={t('source.licencePh', 'e.g. Khmer dubbing licence #123, valid until 2027-12-31')} value={v.licence} onChange={(e) => setV({ ...v, licence: e.target.value })} />
          </Field>
          <Field label={t('source.notes', 'Notes')}>
            <textarea
              className="min-h-20 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={v.notes ?? ''}
              onChange={(e) => setV({ ...v, notes: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={save}>{t('common.save', 'Save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
