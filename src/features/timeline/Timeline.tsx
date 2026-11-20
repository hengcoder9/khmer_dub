import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftToLine, ArrowRightToLine, ChevronDown, Crop, Scissors, SquareSplitHorizontal, Trash2, Waves, ZoomIn, ZoomOut } from 'lucide-react'
import { toast } from 'sonner'
import type { Aspect, BackendInfo, EditState, Episode, Range, Segment } from '@shared/types'
import { addRemoved, effectiveClips, fullClip, MIN_CLIP, normalize, splitClipAt } from '@shared/ranges'
import { api, backend } from '@/lib/api'
import { cn, formatTime, isTyping } from '@/lib/utils'
import { mutate, patchSegments, sortSegments, updateEpisode, updateSegments, useActiveEpisode, useProject } from '@/store/project'
import { playerApi, useUi } from '@/store/ui'
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger, Slider, Toggle } from '@/components/ui/controls'
import { actorColor } from '@/features/grid/SegmentGrid'
import { newSegment } from '@shared/defaults'

const LABEL_W = 56
const TRACK_H = { V1: 34, ORIG: 30, T1: 30, A1: 26, A2: 30 }

// ───────── peaks cache ─────────
const peaksCache = new Map<string, Promise<{ rate: number; peaks: number[] }>>()
function loadPeaks(path: string) {
  if (!peaksCache.has(path)) {
    const p = api<{ rate: number; peaks: number[] }>(`/media/peaks?path=${encodeURIComponent(path)}`)
    p.catch(() => peaksCache.delete(path))
    peaksCache.set(path, p)
  }
  return peaksCache.get(path)!
}

function useBackendInfo() {
  const [b, setB] = useState<BackendInfo | null>(null)
  useEffect(() => {
    backend().then(setB)
  }, [])
  return b
}

function WaveTrack({ path, zoom, scrollLeft, width, height, color }: { path?: string; zoom: number; scrollLeft: number; width: number; height: number; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<{ rate: number; peaks: number[] } | null>(null)
  useEffect(() => {
    setData(null)
    if (path) loadPeaks(path).then(setData).catch(() => {})
  }, [path])
  useLayoutEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.max(1, width * dpr)
    c.height = height * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, width, height)
    if (!data) return
    g.fillStyle = color
    const mid = height / 2
    const perPx = data.rate / zoom
    for (let x = 0; x < width; x++) {
      const t0 = Math.floor((scrollLeft + x) * perPx)
      const t1 = Math.max(t0 + 1, Math.floor((scrollLeft + x + 1) * perPx))
      let m = 0
      for (let i = t0; i < t1 && i < data.peaks.length; i++) if (data.peaks[i] > m) m = data.peaks[i]
      const h = Math.max(0.5, Math.sqrt(m) * mid * 0.95)
      g.fillRect(x, mid - h, 1, h * 2)
    }
  }, [data, zoom, scrollLeft, width, height, color])
  return <canvas ref={canvas} className="absolute top-0" style={{ left: scrollLeft, width, height }} />
}

const THUMB_STEPS = [1, 2, 5, 10, 20, 30, 60, 120, 300]

function ThumbTrack({ ep, zoom, scrollLeft, width, b }: { ep: Episode; zoom: number; scrollLeft: number; width: number; b: BackendInfo | null }) {
  if (!b || !ep.videoPath) return null
  const thumbW = 60
  const step = THUMB_STEPS.find((s) => s * zoom >= thumbW) ?? 600
  const first = Math.floor(scrollLeft / zoom / step) * step
  // the last frame is often not seekable; stay a bit before the end
  const last = Math.min(ep.durationSec - 0.5, (scrollLeft + width) / zoom)
  const items: number[] = []
  for (let t = first; t <= last; t += step) items.push(t)
  return (
    <>
      {items.map((t) => (
        <img
          key={t}
          draggable={false}
          src={`http://127.0.0.1:${b.port}/media/thumb?path=${encodeURIComponent(ep.videoPath)}&t=${t}&w=96&token=${b.token}`}
          className="absolute top-0 h-full object-cover opacity-80"
          style={{ left: t * zoom, width: Math.min(step * zoom, 96) }}
        />
      ))}
    </>
  )
}

type Drag = { id: string; mode: 'move' | 'l' | 'r'; x0: number; s0: number; e0: number; start: number; end: number }

export function Timeline() {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const cast = useProject((s) => s.project?.cast ?? [])
  const settings = useProject((s) => s.project?.settings)
  const selected = useProject((s) => s.selected)
  const zoom = useUi((s) => s.zoom)
  const time = useUi((s) => s.time)
  const playing = useUi((s) => s.playing)
  const setUi = useUi((s) => s.set)
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewW, setViewW] = useState(800)
  const [drag, setDrag] = useState<Drag | null>(null)
  const b = useBackendInfo()
  const duration = ep?.durationSec || Math.max(10, ...(ep?.segments.map((s) => s.end) ?? [0]))
  const totalW = duration * zoom + 40

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // follow playhead
  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const x = time * zoom
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 60
  }, [time, zoom, playing])

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return
    const el = scroller.current!
    const rect = el.getBoundingClientRect()
    const atT = (el.scrollLeft + e.clientX - rect.left) / zoom
    const z = Math.max(2, Math.min(400, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
    setUi({ zoom: z })
    requestAnimationFrame(() => (el.scrollLeft = atT * z - (e.clientX - rect.left)))
  }

  const seekAt = (clientX: number) => {
    const el = scroller.current!
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft
    playerApi()?.seek(Math.max(0, Math.min(duration, x / zoom)))
  }

  // visible segments only
  const visible = useMemo(() => {
    const t0 = scrollLeft / zoom - 1
    const t1 = (scrollLeft + viewW) / zoom + 1
    return (ep?.segments ?? []).filter((s) => s.end >= t0 && s.start <= t1)
  }, [ep?.segments, scrollLeft, viewW, zoom])

  // cut (removed) regions for the overlay
  const cutRegions = useMemo(() => {
    if (!ep?.edit.enabled) return []
    const keep = normalize(effectiveClips(ep.edit))
    const gaps: Array<{ start: number; end: number }> = []
    let pos = 0
    for (const k of keep) {
      if (k.start > pos + 0.01) gaps.push({ start: pos, end: k.start })
      pos = Math.max(pos, k.end)
    }
    if (pos < duration - 0.01) gaps.push({ start: pos, end: duration })
    return gaps
  }, [ep?.edit, duration])

  const startDrag = (e: React.PointerEvent, s: Segment, mode: Drag['mode']) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    useProject.setState({ selected: e.ctrlKey ? new Set([...selected, s.id]) : new Set([s.id]), focusId: s.id })
    setDrag({ id: s.id, mode, x0: e.clientX, s0: s.start, e0: s.end, start: s.start, end: s.end })
  }

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return
      const dt = (e.clientX - drag.x0) / zoom
      const snap = (v: number) => Math.round(v * 100) / 100
      let { s0: start, e0: end } = drag
      if (drag.mode === 'move') {
        start = Math.max(0, drag.s0 + dt)
        end = start + (drag.e0 - drag.s0)
      } else if (drag.mode === 'l') start = Math.max(0, Math.min(drag.e0 - 0.1, drag.s0 + dt))
      else end = Math.max(drag.s0 + 0.1, Math.min(duration, drag.e0 + dt))
      setDrag({ ...drag, start: snap(start), end: snap(end) })
    },
    [drag, zoom, duration]
  )

  const endDrag = () => {
    if (!drag || !ep) return setDrag(null)
    if (drag.start !== drag.s0 || drag.end !== drag.e0) {
      if (drag.mode === 'move') updateSegments(ep.id, (segs) => sortSegments(segs.map((s) => (s.id === drag.id ? { ...s, start: drag.start, end: drag.end } : s))))
      else patchSegments(ep.id, [drag.id], { start: drag.start, end: drag.end })
    } else {
      const s = ep.segments.find((x) => x.id === drag.id)
      if (s) playerApi()?.seek(s.start)
    }
    setDrag(null)
  }

  const splitAtPlayhead = () => {
    if (!ep) return
    const s = ep.segments.find((x) => time > x.start + 0.1 && time < x.end - 0.1)
    if (!s) return
    const a = { ...s, end: Math.round(time * 100) / 100, audioPath: undefined }
    const b2 = { ...newSegment(time, s.end, '', ''), actorId: s.actorId, voiceId: s.voiceId }
    updateSegments(ep.id, (segs) => sortSegments(segs.flatMap((x) => (x.id === s.id ? [a, b2] : [x]))))
  }

  const setSetting = (patch: Partial<NonNullable<typeof settings>>) => mutate((p) => ({ ...p, settings: { ...p.settings, ...patch } }), { undo: false })

  // ───────── video clip editing (split / trim / delete / crop) ─────────
  const [clipSel, setClipSel] = useState<Range | null>(null)
  const vclips = useMemo(
    () => (!ep ? [] : ep.edit.enabled && ep.edit.clips.length ? effectiveClips(ep.edit) : fullClip(duration)),
    [ep?.edit, duration]
  )
  const clipAt = (t: number) => vclips.find((c) => t >= c.start && t < c.end)

  /** Apply a change to the edit list; editing turns "Apply edits on export" on. Undo with Ctrl+Z. */
  const editVideo = (fn: (e: EditState) => EditState) => {
    if (!ep) return
    updateEpisode(ep.id, (x) => {
      const base = x.edit.clips.length ? x.edit : { ...x.edit, clips: fullClip(x.durationSec) }
      return { ...x, edit: { ...fn(base), enabled: true } }
    })
  }
  const noClip = () => toast.info(t('tl.noClip', 'Move the playhead onto the video first'))

  const splitVideo = () => {
    const c = clipAt(time)
    if (!c || time - c.start < MIN_CLIP || c.end - time < MIN_CLIP) return noClip()
    editVideo((e) => ({ ...e, clips: splitClipAt(e.clips, time, `c${Date.now().toString(36)}`) }))
  }
  const trimStart = () => {
    const c = clipAt(time)
    if (!c || time - c.start < MIN_CLIP) return noClip()
    editVideo((e) => ({ ...e, removed: addRemoved(e.removed, { start: c.start, end: time }) }))
  }
  const trimEnd = () => {
    const c = clipAt(time)
    if (!c || c.end - time < MIN_CLIP) return noClip()
    editVideo((e) => ({ ...e, removed: addRemoved(e.removed, { start: time, end: c.end }) }))
  }
  const deleteClip = () => {
    const c = clipSel ?? clipAt(time)
    if (!c) return noClip()
    if (vclips.length <= 1 && Math.abs(c.end - c.start - (vclips[0].end - vclips[0].start)) < 0.01)
      return void toast.info(t('tl.lastClip', "Can't delete the whole video — split it first"))
    editVideo((e) => ({ ...e, removed: addRemoved(e.removed, { start: c.start, end: c.end }) }))
    setClipSel(null)
  }
  const setFormat = (patch: Partial<Pick<EditState, 'aspect' | 'fitMode'>>) => editVideo((e) => ({ ...e, ...patch }))

  // shortcuts: Ctrl+B split, Q trim start, W trim end, Delete removes selected clip
  const keys = useRef({ splitVideo, trimStart, trimEnd, deleteClip, clipSel })
  keys.current = { splitVideo, trimStart, trimEnd, deleteClip, clipSel }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || document.querySelector('[role="dialog"]')) return
      const k = e.key.toLowerCase()
      const a = keys.current
      if (e.ctrlKey && k === 'b') (e.preventDefault(), a.splitVideo())
      else if (e.ctrlKey) return
      else if (k === 'q') a.trimStart()
      else if (k === 'w') a.trimEnd()
      else if ((k === 'delete' || k === 'backspace') && a.clipSel) (e.preventDefault(), a.deleteClip())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ep) return null
  const ticks: number[] = []
  const tickStep = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * zoom >= 70) ?? 1200
  for (let tt = Math.floor(scrollLeft / zoom / tickStep) * tickStep; tt <= (scrollLeft + viewW) / zoom; tt += tickStep) ticks.push(tt)

  const rows: Array<[keyof typeof TRACK_H, string]> = [
    ['V1', 'V1'],
    ['ORIG', 'ORIG'],
    ['T1', 'T1'],
    ['A1', 'A1'],
    ['A2', 'A2']
  ]
  const top = (k: keyof typeof TRACK_H) => {
    let y = 20
    for (const [id] of rows) {
      if (id === k) return y
      y += TRACK_H[id] + 2
    }
    return y
  }
  const height = top('A2') + TRACK_H.A2 + 4

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <ZoomOut className="size-3.5 text-muted-foreground" />
        <input type="range" min={2} max={400} step={1} value={zoom} onChange={(e) => setUi({ zoom: Number(e.target.value) })} className="w-28" title={t('tl.zoom', 'Zoom (Ctrl+wheel)')} />
        <ZoomIn className="size-3.5 text-muted-foreground" />
        <div className="mx-1 h-5 w-px bg-border" />
        {/* video tools */}
        <button className="rounded p-1 hover:bg-accent" title={t('tl.splitVideo', 'Split video at playhead (Ctrl+B)')} onClick={splitVideo}>
          <Scissors className="size-4" />
        </button>
        <button className="rounded p-1 hover:bg-accent" title={t('tl.trimStart', 'Cut out from clip start to playhead (Q)')} onClick={trimStart}>
          <ArrowLeftToLine className="size-4" />
        </button>
        <button className="rounded p-1 hover:bg-accent" title={t('tl.trimEnd', 'Cut out from playhead to clip end (W)')} onClick={trimEnd}>
          <ArrowRightToLine className="size-4" />
        </button>
        <button className="rounded p-1 hover:bg-accent" title={t('tl.deleteClip', 'Delete selected clip (Delete)')} onClick={deleteClip}>
          <Trash2 className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownTrigger asChild>
            <button className={cn('flex items-center gap-0.5 rounded p-1 text-xs hover:bg-accent', ep.edit.enabled && ep.edit.aspect !== 'source' && 'text-primary')} title={t('tl.crop', 'Crop / format')}>
              <Crop className="size-4" />
              {ep.edit.enabled && ep.edit.aspect !== 'source' && ep.edit.aspect}
              <ChevronDown className="size-3 opacity-60" />
            </button>
          </DropdownTrigger>
          <DropdownContent align="start" className="w-52">
            <DropdownLabel>{t('tl.format', 'Format')}</DropdownLabel>
            {(
              [
                ['source', t('tl.original', 'Original')],
                ['16:9', '16:9 YouTube'],
                ['9:16', '9:16 TikTok / Reels'],
                ['1:1', '1:1 Square'],
                ['4:5', '4:5 Instagram']
              ] as Array<[Aspect, string]>
            ).map(([a, label]) => (
              <DropdownItem key={a} onSelect={() => setFormat({ aspect: a })}>
                {label} {(ep.edit.enabled ? ep.edit.aspect : 'source') === a && '✓'}
              </DropdownItem>
            ))}
            <DropdownSeparator />
            <DropdownLabel>{t('tl.fit', 'Fit')}</DropdownLabel>
            {(
              [
                ['crop', t('tl.fitCrop', 'Crop to fill')],
                ['pad', t('tl.fitPad', 'Fit with black bars')],
                ['blur', t('tl.fitBlur', 'Fit with blurred background')]
              ] as Array<[EditState['fitMode'], string]>
            ).map(([m, label]) => (
              <DropdownItem key={m} onSelect={() => setFormat({ fitMode: m })}>
                {label} {ep.edit.fitMode === m && '✓'}
              </DropdownItem>
            ))}
          </DropdownContent>
        </DropdownMenu>
        <div className="mx-1 h-5 w-px bg-border" />
        <button className="rounded p-1 hover:bg-accent" title={t('tl.cut', 'Split subtitle line at playhead')} onClick={splitAtPlayhead}>
          <SquareSplitHorizontal className="size-4" />
        </button>
        <div className="mx-1 h-5 w-px bg-border" />
        {settings && (
          <>
            <Slider className="w-36" label={t('tl.speed', 'Speed')} min={0.7} max={1.5} step={0.05} value={settings.globalSpeed} onChange={(v) => setSetting({ globalSpeed: v })} format={(v) => `${v.toFixed(2)}×`} />
            <Slider className="w-36" label={t('tl.pitch', 'Pitch')} min={-30} max={30} step={1} value={settings.globalPitch} onChange={(v) => setSetting({ globalPitch: v })} format={(v) => `${v > 0 ? '+' : ''}${v}Hz`} />
            <Slider className="w-36" label={t('tl.volume', 'Volume')} min={0} max={2} step={0.05} value={settings.globalVolume} onChange={(v) => setSetting({ globalVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Toggle on={settings.reverb} onClick={() => setSetting({ reverb: !settings.reverb })} title={t('tl.reverbHint', 'Add room reverb to dub voices')}>
              <Waves /> {t('tl.reverb', 'Reverb')}
            </Toggle>
          </>
        )}
        <div className="flex-1" />
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatTime(time)}</span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 border-r bg-muted/30 pt-5 text-[10px] font-semibold text-muted-foreground" style={{ width: LABEL_W }}>
          {rows.map(([id, label]) => (
            <div key={id} className="flex items-center px-2" style={{ height: TRACK_H[id], marginBottom: 2 }}>
              {label}
            </div>
          ))}
        </div>
        <div
          ref={scroller}
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
          onWheel={onWheel}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        >
          <div className="relative" style={{ width: totalW, height }} onPointerDown={(e) => e.button === 0 && seekAt(e.clientX)}>
            {/* ruler */}
            <div className="absolute inset-x-0 top-0 h-5 border-b bg-muted/40">
              {ticks.map((tt) => (
                <div key={tt} className="absolute top-0 h-full border-l border-border pl-1 font-mono text-[9px] text-muted-foreground" style={{ left: tt * zoom }}>
                  {formatTime(tt).slice(tt >= 3600 ? 0 : 3, tickStep < 1 ? 11 : 8)}
                </div>
              ))}
            </div>
            {/* V1 */}
            <div className="absolute inset-x-0 overflow-hidden bg-muted/40" style={{ top: top('V1'), height: TRACK_H.V1 }}>
              <ThumbTrack ep={ep} zoom={zoom} scrollLeft={scrollLeft} width={viewW} b={b} />
              {/* video clips: click to select (Delete removes it) */}
              {vclips.map((c) => {
                const sel = !!clipSel && Math.abs(clipSel.start - c.start) < 0.001 && Math.abs(clipSel.end - c.end) < 0.001
                return (
                  <div
                    key={`${c.id}-${c.start}`}
                    className={cn('absolute inset-y-0 rounded-sm border-2', sel ? 'border-white' : 'border-primary/70 hover:border-primary')}
                    style={{ left: c.start * zoom, width: Math.max(2, (c.end - c.start) * zoom) }}
                    title={`${formatTime(c.start)} → ${formatTime(c.end)}`}
                    onPointerDown={() => setClipSel(sel ? null : { start: c.start, end: c.end })}
                  />
                )
              })}
            </div>
            {/* ORIG */}
            <div className="absolute inset-x-0 bg-muted/30" style={{ top: top('ORIG'), height: TRACK_H.ORIG }}>
              <WaveTrack path={ep.stems.full ?? (ep.videoPath || undefined)} zoom={zoom} scrollLeft={scrollLeft} width={viewW} height={TRACK_H.ORIG} color="rgba(148,163,184,.75)" />
            </div>
            {/* T1 subtitles */}
            <div className="absolute inset-x-0 bg-muted/20" style={{ top: top('T1'), height: TRACK_H.T1 }}>
              {visible.map((s) => {
                const d = drag?.id === s.id ? drag : null
                const st = d ? d.start : s.start
                const en = d ? d.end : s.end
                const sel = selected.has(s.id)
                const c = actorColor(cast, s.actorId)
                return (
                  <div
                    key={s.id}
                    className={cn('absolute top-0.5 flex h-[calc(100%-4px)] cursor-grab items-center overflow-hidden rounded-sm border px-1 text-[11px] text-white', sel ? 'ring-2 ring-white' : '')}
                    style={{ left: st * zoom, width: Math.max(2, (en - st) * zoom), background: `${c}cc`, borderColor: c }}
                    title={`${formatTime(st)} → ${formatTime(en)}\n${s.textTarget || s.textOriginal}`}
                    onPointerDown={(e) => startDrag(e, s, 'move')}
                    onDoubleClick={() => useUi.getState().set({ editingId: s.id, centerTab: 'dub' })}
                  >
                    <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => startDrag(e, s, 'l')} />
                    <span className="pointer-events-none truncate font-hanuman">{s.textTarget || s.textOriginal}</span>
                    <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => startDrag(e, s, 'r')} />
                  </div>
                )
              })}
            </div>
            {/* A1 dub clips */}
            <div className="absolute inset-x-0 bg-muted/20" style={{ top: top('A1'), height: TRACK_H.A1 }}>
              {visible
                .filter((s) => s.audioPath && s.audioDur)
                .map((s) => (
                  <div
                    key={s.id}
                    className={cn('absolute top-0.5 h-[calc(100%-4px)] rounded-sm', s.fitWarning ? 'bg-warning/80' : 'bg-emerald-500/70')}
                    style={{ left: s.start * zoom, width: Math.max(2, (s.audioDur ?? 0) * zoom) }}
                    title={`${s.audioDur}s${s.fitSpeed ? ` @ ${s.fitSpeed}×` : ''}${s.fitWarning ? ' ▲' : ''}`}
                  />
                ))}
              {ep.voiceTrack && (
                <WaveTrack path={ep.voiceTrack} zoom={zoom} scrollLeft={scrollLeft} width={viewW} height={TRACK_H.A1} color="rgba(16,185,129,.8)" />
              )}
            </div>
            {/* A2 instrumental / BGM */}
            <div className="absolute inset-x-0 bg-muted/30" style={{ top: top('A2'), height: TRACK_H.A2 }}>
              <WaveTrack path={ep.stems.instrumental ?? ep.edit.bgm?.path} zoom={zoom} scrollLeft={scrollLeft} width={viewW} height={TRACK_H.A2} color="rgba(139,92,246,.75)" />
            </div>
            {/* cuts from the AI editor */}
            {cutRegions.map((r, i) => (
              <div
                key={i}
                className="pointer-events-none absolute bottom-0 border-x border-destructive/50"
                style={{
                  top: 20,
                  left: r.start * zoom,
                  width: (r.end - r.start) * zoom,
                  background: 'repeating-linear-gradient(135deg, hsl(var(--destructive) / .18) 0 6px, transparent 6px 12px)'
                }}
              />
            ))}
            {/* playhead */}
            <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-500" style={{ left: time * zoom }}>
              <div className="absolute -left-1 top-0 size-2 rotate-45 bg-red-500" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
