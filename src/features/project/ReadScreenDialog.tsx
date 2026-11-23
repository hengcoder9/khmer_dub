import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, Check, Loader2, Play, Pause, RotateCcw, ScanText, TextSelect, Wand2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useActiveEpisode } from '@/store/project'
import { useSettings } from '@/store/settings'
import { mediaUrl } from '@/lib/api'
import { applyScreenLines, findScreenArea, notify, readScreenArea, type ScreenLine } from '@/lib/pipeline'
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/utils'
import { toast } from 'sonner'

type Phase = 'area' | 'working' | 'review'
type Region = { top: number; bottom: number }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const stamp = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** Guided "Read on-screen subtitles": mark where the subtitles are, let the AI read + translate them, review, use. */
export function ReadScreenDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const vref = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [region, setRegion] = useState<Region>(() => {
    const top = useSettings.getState().ocrCropTop
    return { top: clamp(top, 0.05, 0.9), bottom: clamp(top + 0.2, 0.15, 1) }
  })
  const [phase, setPhase] = useState<Phase>('area')
  const [stage, setStage] = useState<'read' | 'translate'>('read')
  const [finding, setFinding] = useState(false)
  const [lines, setLines] = useState<ScreenLine[]>([])
  const [trErr, setTrErr] = useState<string>()
  const [active, setActive] = useState(0)

  useEffect(() => {
    let alive = true
    if (ep?.videoPath) void mediaUrl(ep.videoPath).then((u) => alive && setSrc(u))
    return () => {
      alive = false
    }
  }, [ep?.videoPath])

  if (!ep) return null
  const vw = ep.media?.video?.width || 9
  const vh = ep.media?.video?.height || 16
  const dur = ep.durationSec || 0

  // drag the band: body moves it, the two edges resize it
  const drag = (mode: 'move' | 'top' | 'bottom') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = box.current!.getBoundingClientRect()
    const y0 = e.clientY
    const r0 = region
    const move = (ev: PointerEvent) => {
      const d = (ev.clientY - y0) / rect.height
      if (mode === 'move') {
        const h = r0.bottom - r0.top
        const top = clamp(r0.top + d, 0, 1 - h)
        setRegion({ top, bottom: top + h })
      } else if (mode === 'top') setRegion({ top: clamp(r0.top + d, 0, r0.bottom - 0.04), bottom: r0.bottom })
      else setRegion({ top: r0.top, bottom: clamp(r0.bottom + d, r0.top + 0.04, 1) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const find = async () => {
    setFinding(true)
    try {
      const a = await findScreenArea(ep.id)
      if (a) {
        setRegion({ top: clamp(a.top, 0, 0.95), bottom: clamp(a.bottom, a.top + 0.04, 1) })
        toast.success(t('rs.found', 'Found the subtitles'))
      } else toast.info(t('rs.notFound', "Couldn't see on-screen subtitles — drag the box over them yourself"))
    } catch (e) {
      notify(e)
    } finally {
      setFinding(false)
    }
  }

  const start = async () => {
    useSettings.getState().set({ ocrCropTop: region.top })
    setPhase('working')
    setStage('read')
    try {
      const r = await readScreenArea(region, ep.id, setStage)
      if (!r.lines.length) {
        toast.info(t('rs.none', 'No subtitle text was found in that area — adjust the box and try again'))
        setPhase('area')
        return
      }
      setLines(r.lines)
      setTrErr(r.translateError)
      setActive(0)
      setPhase('review')
    } catch (e) {
      setPhase('area')
      if ((e as Error).message !== 'Canceled') notify(e)
    }
  }

  const jump = (i: number) => {
    setActive(i)
    const v = vref.current
    if (v) v.currentTime = lines[i].start
  }

  const use = () => {
    if (ep.segments.length && !confirm(t('rs.replace', 'Replace the {{n}} existing lines with these?', { n: ep.segments.length }))) return
    applyScreenLines(lines, ep.id)
    onClose()
  }

  const showBand = phase === 'area'

  return (
    <Dialog open onOpenChange={(o) => !o && phase !== 'working' && onClose()}>
      <DialogContent className="flex h-[min(86vh,720px)] w-[min(94vw,940px)] flex-col overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b px-5 py-3.5">
          <span className="grid size-10 place-items-center rounded-xl bg-brand text-white shadow-md">
            <ScanText className="size-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle>{t('rs.title', 'Read on-screen subtitles')}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t('rs.desc', 'The exact words and timing, read from the picture instead of guessed from the sound.')}
            </DialogDescription>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* video + subtitle area */}
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
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                )}
                {showBand && (
                  <div className="absolute inset-x-0 cursor-move border-y-2 border-primary bg-primary/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" style={{ top: `${region.top * 100}%`, height: `${(region.bottom - region.top) * 100}%` }} onPointerDown={drag('move')}>
                    <span className="absolute -top-6 left-1 flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      <TextSelect className="size-3" /> {t('rs.area', 'Subtitle area')}
                    </span>
                    <span className="absolute inset-x-0 -top-1.5 h-3 cursor-ns-resize" onPointerDown={drag('top')} />
                    <span className="absolute inset-x-0 -bottom-1.5 h-3 cursor-ns-resize" onPointerDown={drag('bottom')} />
                    <span className="absolute left-1/2 top-0 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
                    <span className="absolute bottom-0 left-1/2 h-1 w-10 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary" />
                  </div>
                )}
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
              {showBand && (
                <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={find} disabled={finding}>
                  {finding ? <Loader2 className="animate-spin" /> : <Wand2 />} {t('rs.find', 'Find it for me')}
                </Button>
              )}
            </div>
          </div>

          {/* right pane */}
          <div className="flex min-h-0 flex-col border-l">
            {phase === 'area' && (
              <div className="flex flex-1 flex-col justify-between p-5">
                <div className="flex flex-col gap-3 text-sm">
                  <h3 className="text-base font-semibold">{t('rs.step1', 'Mark where the subtitles are')}</h3>
                  <p className="text-muted-foreground">{t('rs.step1b', 'Drag the box so it covers the subtitle text, or press “Find it for me”. Only this strip is read, so logos and watermarks are ignored.')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('rs.tip', 'Tip: pause on a frame that shows a subtitle, then position the box over it.')}
                  </p>
                </div>
                <Button size="lg" className="h-11 w-full bg-brand text-white" onClick={start} disabled={!src}>
                  {t('rs.read', 'Read the subtitles')} <ArrowRight />
                </Button>
              </div>
            )}

            {phase === 'working' && (
              <div className="grid flex-1 place-items-center p-6 text-center">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="size-9 animate-spin text-primary" />
                  <div className="font-semibold">{stage === 'read' ? t('rs.reading', 'Reading the subtitles from the picture…') : t('rs.translating', 'Translating the lines…')}</div>
                  <div className="text-xs text-muted-foreground">{t('rs.working', 'Progress is in the job list at the bottom. This can take a minute.')}</div>
                </div>
              </div>
            )}

            {phase === 'review' && (
              <>
                <div className="flex items-center gap-3 border-b px-5 py-3">
                  <span className="grid size-10 place-items-center rounded-full bg-success/15 text-success">
                    <Check className="size-5" />
                  </span>
                  <div>
                    <div className="font-semibold">{trErr ? t('rs.readOnly', '{{n}} lines read', { n: lines.length }) : t('rs.readTr', '{{n}} lines read and translated', { n: lines.length })}</div>
                    {trErr && <div className="text-xs text-warning">{t('rs.trFail', 'Translation failed ({{e}}) — you can translate later', { e: trErr })}</div>}
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {lines.map((l, i) => (
                    <button
                      key={i}
                      onClick={() => jump(i)}
                      className={cn('flex w-full flex-col gap-1.5 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/40', active === i && 'border-primary/60 ring-1 ring-primary/30')}
                    >
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">{stamp(l.start)}</span>
                        <div className="min-w-0">
                          <div className="font-hanuman text-sm leading-snug">{l.target || l.original}</div>
                          {l.target && <div className="text-xs text-muted-foreground">{l.original}</div>}
                        </div>
                      </div>
                      {l.thumb && <img src={l.thumb} alt="" className="mx-auto max-h-14 rounded object-contain" />}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2 border-t p-3">
                  <Button size="lg" className="h-11 w-full bg-brand text-white" onClick={use}>
                    {t('rs.use', 'Use these lines')} <ArrowRight />
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={() => setPhase('area')}>
                      <ArrowLeft /> {t('rs.adjust', 'Adjust area')}
                    </Button>
                    <Button variant="outline" onClick={() => void start()}>
                      <RotateCcw /> {t('rs.again', 'Start over')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
