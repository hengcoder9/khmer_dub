import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EyeOff, Loader2, Pause, Play, Square, Trash2, Wand2, Droplets } from 'lucide-react'
import type { SubCover } from '@shared/types'
import { SUBCOVER_DEFAULT, normCover } from '@shared/subcover'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider, Switch } from '@/components/ui/controls'
import { mutate, useActiveEpisode, useProject } from '@/store/project'
import { mediaUrl } from '@/lib/api'
import { findScreenArea, notify } from '@/lib/pipeline'
import { cn, formatTime } from '@/lib/utils'
import { toast } from 'sonner'
import { SubCoverLayer } from './SubCoverLayer'

type Edge = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const MIN = 0.03

/** "Hide old subtitles": blur (or cover with a bar) the subtitles already burned into the source video, in every export. */
export function SubCoverDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const saved = useProject((s) => s.project?.settings.subCover)
  const [c, setC] = useState<SubCover>(() => normCover(saved ?? SUBCOVER_DEFAULT))
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [finding, setFinding] = useState(false)
  const vref = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    if (ep?.videoPath) void mediaUrl(ep.videoPath).then((u) => alive && setSrc(u))
    return () => {
      alive = false
    }
  }, [ep?.videoPath])

  // opening the dialog shows a frame a little into the video (the first frame is often black)
  useEffect(() => {
    const v = vref.current
    if (v && src && ep?.durationSec) v.currentTime = Math.min(ep.durationSec * 0.2, 30)
  }, [src, ep?.durationSec])

  /** save to the project (also creates the setting the first time) */
  const commit = (next: SubCover | null) =>
    mutate((p) => ({ ...p, settings: { ...p.settings, subCover: next ? normCover(next) : undefined } }))
  const patch = (pt: Partial<SubCover>) => {
    const next = normCover({ ...c, ...pt })
    setC(next)
    commit(next)
  }

  // drag the body to move, an edge or corner to resize; saved once when the drag ends
  const drag = (edge: Edge) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = box.current!.getBoundingClientRect()
    const x0 = e.clientX
    const y0 = e.clientY
    const r0 = c
    let last = c
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / rect.width
      const dy = (ev.clientY - y0) / rect.height
      let { x, y, w, h } = r0
      if (edge === 'move') {
        x = clamp(r0.x + dx, 0, 1 - r0.w)
        y = clamp(r0.y + dy, 0, 1 - r0.h)
      } else {
        if (edge.includes('n')) {
          y = clamp(r0.y + dy, 0, r0.y + r0.h - MIN)
          h = r0.y + r0.h - y
        }
        if (edge.includes('s')) h = clamp(r0.h + dy, MIN, 1 - r0.y)
        if (edge.includes('w')) {
          x = clamp(r0.x + dx, 0, r0.x + r0.w - MIN)
          w = r0.x + r0.w - x
        }
        if (edge.includes('e')) w = clamp(r0.w + dx, MIN, 1 - r0.x)
      }
      last = { ...r0, x, y, w, h }
      setC(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      commit(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const find = async () => {
    if (!ep) return
    setFinding(true)
    try {
      const a = await findScreenArea(ep.id)
      if (a) {
        // the finder gives the subtitle band's height; add a little room above and below
        const pad = 0.01
        const y = clamp(a.top - pad, 0, 0.97)
        patch({ y, h: clamp(a.bottom + pad, y + MIN, 1) - y, enabled: true })
        toast.success(t('sc.found', 'Found the old subtitles — adjust the box if needed'))
      } else toast.info(t('rs.notFound', "Couldn't see on-screen subtitles — drag the box over them yourself"))
    } catch (e) {
      notify(e)
    } finally {
      setFinding(false)
    }
  }

  if (!ep) return null
  const vw = ep.media?.video?.width || 16
  const vh = ep.media?.video?.height || 9
  const dur = ep.durationSec || 0
  const handle = 'absolute size-3 rounded-full border-2 border-primary bg-white'
  const edgeH = 'absolute inset-x-3 h-2.5 cursor-ns-resize'
  const edgeV = 'absolute inset-y-3 w-2.5 cursor-ew-resize'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[min(86vh,680px)] w-[min(94vw,960px)] flex-col overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b px-5 py-3.5">
          <span className="grid size-10 place-items-center rounded-xl bg-brand text-white shadow-md">
            <EyeOff className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle>{t('sc.title', 'Hide old subtitles')}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t('sc.desc', 'Blur the subtitles that are already burned into the video, so only your new Khmer subtitles show.')}
            </DialogDescription>
          </div>
          <Switch checked={c.enabled} onChange={(v) => patch({ enabled: v })} label={c.enabled ? t('sc.on', 'On') : t('sc.off', 'Off')} />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* video with the area */}
          <div className="flex min-h-0 flex-col gap-2 bg-black/90 p-3">
            <div className="grid min-h-0 flex-1 place-items-center">
              <div ref={box} className="relative max-h-full max-w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${vw} / ${vh}`, height: '100%' }}>
                {src && (
                  <video
                    ref={vref}
                    src={src}
                    muted
                    className="size-full object-contain"
                    onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                    onSeeked={(e) => setTime(e.currentTarget.currentTime)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                )}
                {c.enabled && <SubCoverLayer cover={c} srcAspect={vw / vh} />}
                <div
                  className={cn('absolute cursor-move rounded-[3px] border-2 border-dashed', c.enabled ? 'border-primary' : 'border-white/60')}
                  style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                  onPointerDown={drag('move')}
                >
                  <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    {t('sc.area', 'Old subtitles')}
                  </span>
                  <span className={cn(edgeH, '-top-1.5')} onPointerDown={drag('n')} />
                  <span className={cn(edgeH, '-bottom-1.5')} onPointerDown={drag('s')} />
                  <span className={cn(edgeV, '-left-1.5')} onPointerDown={drag('w')} />
                  <span className={cn(edgeV, '-right-1.5')} onPointerDown={drag('e')} />
                  <span className={cn(handle, '-left-1.5 -top-1.5 cursor-nwse-resize')} onPointerDown={drag('nw')} />
                  <span className={cn(handle, '-right-1.5 -top-1.5 cursor-nesw-resize')} onPointerDown={drag('ne')} />
                  <span className={cn(handle, '-bottom-1.5 -left-1.5 cursor-nesw-resize')} onPointerDown={drag('sw')} />
                  <span className={cn(handle, '-bottom-1.5 -right-1.5 cursor-nwse-resize')} onPointerDown={drag('se')} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-white">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => (playing ? vref.current?.pause() : void vref.current?.play())}>
                {playing ? <Pause /> : <Play />}
              </Button>
              <input
                type="range"
                className="min-w-0 flex-1"
                min={0}
                max={dur || 0}
                step={0.05}
                value={Math.min(time, dur)}
                onChange={(e) => vref.current && (vref.current.currentTime = Number(e.target.value))}
                aria-label="Seek"
              />
              <span className="font-mono text-[11px] tabular-nums">
                {formatTime(time).slice(3, 8)} / {formatTime(dur).slice(3, 8)}
              </span>
            </div>
          </div>

          {/* settings */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l p-5 text-sm">
            <p className="text-muted-foreground">{t('sc.help', 'Pause on a frame that shows a subtitle, then drag the box over it. Drag the edges or corners to resize. The same area is hidden for the whole video.')}</p>
            <Button variant="outline" onClick={find} disabled={finding}>
              {finding ? <Loader2 className="animate-spin" /> : <Wand2 />} {t('rs.find', 'Find it for me')}
            </Button>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('sc.style', 'Style')}</span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['blur', Droplets, t('sc.blur', 'Blur'), t('sc.blurHint', 'Soft, keeps the picture')],
                    ['box', Square, t('sc.box', 'Bar'), t('sc.boxHint', 'Solid colour, hides completely')]
                  ] as const
                ).map(([id, Icon, label, hint]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => patch({ mode: id, enabled: true })}
                    className={cn('flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent', c.mode === id && 'border-primary/60 bg-primary/10')}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <Icon className="size-4 text-primary" /> {label}
                    </span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {c.mode === 'blur' ? (
              <Slider
                label={t('sc.strength', 'Strength')}
                min={1}
                max={3}
                step={1}
                value={c.strength ?? 2}
                onChange={(v) => patch({ strength: v })}
                format={(v) => [t('sc.light', 'Light'), t('sc.medium', 'Medium'), t('sc.strong', 'Strong')][v - 1] ?? String(v)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <input type="color" value={c.color ?? '#000000'} onChange={(e) => patch({ color: e.target.value.toUpperCase() })} className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0.5" aria-label={t('sc.color', 'Colour')} />
                <Slider className="flex-1" label={t('wm.opacity', 'Opacity')} min={0.3} max={1} step={0.05} value={c.opacity ?? 0.85} onChange={(v) => patch({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </div>
            )}

            <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              {t('sc.note', 'Shown in the player and applied to every export of this project. Tip: put your new subtitles in the same place so they sit on top of the blur.')}
            </div>
          </div>
        </div>

        <div className="flex justify-between border-t px-5 py-3">
          {saved ? (
            <Button
              variant="ghost"
              onClick={() => {
                commit(null)
                onClose()
              }}
            >
              <Trash2 /> {t('sc.remove', 'Remove')}
            </Button>
          ) : (
            <span />
          )}
          <Button
            onClick={() => {
              // "Done" keeps the box even if it was never dragged
              if (!saved) commit(c)
              onClose()
            }}
          >
            {t('common.done', 'Done')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
