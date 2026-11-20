import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftToLine, ArrowRightToLine, ChevronDown, Crop, Film, RotateCcw, Scissors, SquareSplitHorizontal, Trash2, Waves, X, ZoomIn, ZoomOut } from 'lucide-react'
import { toast } from 'sonner'
import type { Aspect, BackendInfo, Clip, ClipColor, EditState, Episode, Segment, TransitionType } from '@shared/types'
import {
  addRemoved,
  clipSpeed,
  effectiveClips,
  explodeClips,
  fullClip,
  layoutClips,
  MIN_CLIP,
  normalize,
  outputDuration,
  outputToSource,
  rangeToOutput,
  splitClipAt,
  transitionDur,
  trimClipEdge,
  type Placed
} from '@shared/ranges'
import { api, backend } from '@/lib/api'
import { cn, formatTime, isTyping } from '@/lib/utils'
import { mutate, patchSegments, sortSegments, updateEpisode, updateSegments, useActiveEpisode, useProject } from '@/store/project'
import { playerApi, useUi } from '@/store/ui'
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger, Select, Slider, Toggle } from '@/components/ui/controls'
import { actorColor } from '@/features/grid/SegmentGrid'
import { newSegment } from '@shared/defaults'

const LABEL_W = 56
const TRACK_H = { V1: 34, ORIG: 30, T1: 30, A1: 26, A2: 30 }

/** output time → source time (null = nothing there); identity when the timeline shows the source */
type ToSrc = (t: number) => number | null

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

function WaveTrack({ path, zoom, scrollLeft, width, height, color, toSrc }: { path?: string; zoom: number; scrollLeft: number; width: number; height: number; color: string; toSrc?: ToSrc }) {
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
    const at = (px: number) => (toSrc ? toSrc(px / zoom) : px / zoom)
    for (let x = 0; x < width; x++) {
      const a = at(scrollLeft + x)
      if (a === null) continue
      let b = at(scrollLeft + x + 1)
      if (b === null || b < a) b = a + 1 / zoom
      const t0 = Math.floor(a * data.rate)
      const t1 = Math.max(t0 + 1, Math.floor(b * data.rate))
      let m = 0
      for (let i = t0; i < t1 && i < data.peaks.length; i++) if (data.peaks[i] > m) m = data.peaks[i]
      const h = Math.max(0.5, Math.sqrt(m) * mid * 0.95)
      g.fillRect(x, mid - h, 1, h * 2)
    }
  }, [data, zoom, scrollLeft, width, height, color, toSrc])
  return <canvas ref={canvas} className="pointer-events-none absolute top-0" style={{ left: scrollLeft, width, height }} />
}

const THUMB_STEPS = [1, 2, 5, 10, 20, 30, 60, 120, 300]

function ThumbTrack({ ep, zoom, scrollLeft, width, b, total, toSrc }: { ep: Episode; zoom: number; scrollLeft: number; width: number; b: BackendInfo | null; total: number; toSrc?: ToSrc }) {
  if (!b || !ep.videoPath) return null
  const thumbW = 60
  const step = THUMB_STEPS.find((s) => s * zoom >= thumbW) ?? 600
  const first = Math.floor(scrollLeft / zoom / step) * step
  // the last frame is often not seekable; stay a bit before the end
  const last = Math.min(total - 0.3, (scrollLeft + width) / zoom)
  const items: Array<{ at: number; src: number }> = []
  for (let t = first; t <= last; t += step) {
    const s = toSrc ? toSrc(t + 0.05) : t
    if (s !== null) items.push({ at: t, src: Math.min(ep.durationSec - 0.5, Math.round(s * 2) / 2) })
  }
  return (
    <>
      {items.map(({ at, src }) => (
        <img
          key={at}
          draggable={false}
          src={`http://127.0.0.1:${b.port}/media/thumb?path=${encodeURIComponent(ep.videoPath)}&t=${src}&w=96&token=${b.token}`}
          className="pointer-events-none absolute top-0 h-full object-cover opacity-80"
          style={{ left: at * zoom, width: Math.min(step * zoom, 96) }}
        />
      ))}
    </>
  )
}

type Drag = { id: string; mode: 'move' | 'l' | 'r'; x0: number; s0: number; e0: number; start: number; end: number; k: number }
type ClipDrag = { id: string; mode: 'move' | 'l' | 'r'; x0: number; dx: number }

const TRANSITIONS: Array<[TransitionType, string]> = [
  ['fade', 'Crossfade'],
  ['fadeblack', 'Dip to black'],
  ['fadewhite', 'Dip to white'],
  ['dissolve', 'Dissolve'],
  ['slideleft', 'Slide left'],
  ['slideright', 'Slide right'],
  ['wipeleft', 'Wipe left'],
  ['wiperight', 'Wipe right'],
  ['circleopen', 'Circle open'],
  ['zoomin', 'Zoom in']
]
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const TDURS = [0.3, 0.5, 0.8, 1, 1.5, 2]
const NO_COLOR: ClipColor = { brightness: 0, contrast: 1, saturation: 1 }

export function Timeline() {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const cast = useProject((s) => s.project?.cast ?? [])
  const settings = useProject((s) => s.project?.settings)
  const selected = useProject((s) => s.selected)
  const zoom = useUi((s) => s.zoom)
  const time = useUi((s) => s.time)
  const playing = useUi((s) => s.playing)
  const previewEdit = useUi((s) => s.previewEdit)
  const setUi = useUi((s) => s.set)
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewW, setViewW] = useState(800)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [cdrag, setCdrag] = useState<ClipDrag | null>(null)
  const [clipSel, setClipSel] = useState<string | null>(null)
  const b = useBackendInfo()
  const duration = ep?.durationSec || Math.max(10, ...(ep?.segments.map((s) => s.end) ?? [0]))

  // ───────── timeline mapping ─────────
  // "Edited" view ripples every track onto the finished video's timeline: no gaps, clip order and speed applied
  const ripple = !!ep?.edit.enabled && previewEdit
  const vclips = useMemo(
    () => (!ep ? [] : ep.edit.enabled && ep.edit.clips.length ? effectiveClips(ep.edit) : fullClip(duration)),
    [ep?.edit, duration]
  )
  const placed = useMemo<Placed<Clip>[]>(
    () => (ripple ? layoutClips(vclips) : vclips.map((c) => ({ clip: c, outStart: c.start, outLen: c.end - c.start }))),
    [ripple, vclips]
  )
  const total = ripple ? outputDuration(vclips) : duration
  const toSrc = useCallback<ToSrc>((x) => (ripple ? outputToSource(x, vclips) : x), [ripple, vclips])
  /** source range → timeline span (seconds on the timeline), or null when cut */
  const span = useCallback(
    (r: { start: number; end: number }) => (ripple ? rangeToOutput(r, placed) : { start: r.start, end: r.end, speed: 1 }),
    [ripple, placed]
  )
  const at = (s: number) => {
    const r = span({ start: s, end: s + 0.001 })
    return r ? r.start : null
  }
  const totalW = total * zoom + 40
  const timeX = at(time)

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
    if (!el || !playing || timeX === null) return
    const x = timeX * zoom
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 60
  }, [timeX, zoom, playing])

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
    const s = toSrc(Math.max(0, Math.min(total - 0.01, x / zoom)))
    if (s !== null) playerApi()?.seek(Math.max(0, Math.min(duration, s)))
  }

  // visible segments only, with their timeline span
  const visible = useMemo(() => {
    const t0 = scrollLeft / zoom - 1
    const t1 = (scrollLeft + viewW) / zoom + 1
    const out: Array<{ s: Segment; x: { start: number; end: number; speed: number } }> = []
    for (const s of ep?.segments ?? []) {
      const x = span(s)
      if (x && x.end >= t0 && x.start <= t1) out.push({ s, x })
    }
    return out
  }, [ep?.segments, scrollLeft, viewW, zoom, span])

  // cut (removed) regions for the overlay (source view only; the edited view has no gaps)
  const cutRegions = useMemo(() => {
    if (!ep?.edit.enabled || ripple) return []
    const keep = normalize(effectiveClips(ep.edit))
    const gaps: Array<{ start: number; end: number }> = []
    let pos = 0
    for (const k of keep) {
      if (k.start > pos + 0.01) gaps.push({ start: pos, end: k.start })
      pos = Math.max(pos, k.end)
    }
    if (pos < duration - 0.01) gaps.push({ start: pos, end: duration })
    return gaps
  }, [ep?.edit, duration, ripple])

  const startDrag = (e: React.PointerEvent, s: Segment, mode: Drag['mode'], k: number) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    useProject.setState({ selected: e.ctrlKey ? new Set([...selected, s.id]) : new Set([s.id]), focusId: s.id })
    setDrag({ id: s.id, mode, x0: e.clientX, s0: s.start, e0: s.end, start: s.start, end: s.end, k })
  }

  const startClipDrag = (e: React.PointerEvent, id: string, mode: ClipDrag['mode']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setCdrag({ id, mode, x0: e.clientX, dx: 0 })
  }

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (cdrag) return setCdrag({ ...cdrag, dx: e.clientX - cdrag.x0 })
      if (!drag) return
      // drag distance in source seconds (a 2× clip moves its lines twice as far per pixel)
      const dt = ((e.clientX - drag.x0) / zoom) * drag.k
      const snap = (v: number) => Math.round(v * 100) / 100
      let { s0: start, e0: end } = drag
      if (drag.mode === 'move') {
        start = Math.max(0, drag.s0 + dt)
        end = start + (drag.e0 - drag.s0)
      } else if (drag.mode === 'l') start = Math.max(0, Math.min(drag.e0 - 0.1, drag.s0 + dt))
      else end = Math.max(drag.s0 + 0.1, Math.min(duration, drag.e0 + dt))
      setDrag({ ...drag, start: snap(start), end: snap(end) })
    },
    [drag, cdrag, zoom, duration]
  )

  /** Apply a change to the edit list; editing turns "Apply edits on export" and the edited view on. Undo with Ctrl+Z. */
  const editVideo = (fn: (e: EditState) => EditState) => {
    if (!ep) return
    if (!ep.edit.enabled) setUi({ previewEdit: true })
    updateEpisode(ep.id, (x) => {
      const base = x.edit.clips.length ? x.edit : { ...x.edit, clips: fullClip(x.durationSec) }
      // one timeline clip = one base clip, so a piece can be moved/trimmed/styled on its own
      return { ...x, edit: { ...fn({ ...base, clips: explodeClips(base) }), enabled: true } }
    })
  }

  const endClipDrag = () => {
    const d = cdrag
    setCdrag(null)
    if (!d || !ep) return
    const p = placed.find((x) => x.clip.id === d.id)
    if (!p) return
    if (Math.abs(d.dx) < 3) {
      // a click: select (or deselect) the clip and move the playhead there
      if (d.mode === 'move') seekAt(d.x0)
      return setClipSel(clipSel === d.id && d.mode !== 'move' ? null : d.id)
    }
    setClipSel(d.id)
    const sp = ripple ? clipSpeed(p.clip) : 1
    if (d.mode === 'l' || d.mode === 'r') {
      const to = (d.mode === 'l' ? p.clip.start : p.clip.end) + (d.dx / zoom) * sp
      editVideo((e) => ({ ...e, ...trimClipEdge(e, d.id, d.mode as 'l' | 'r', to, ep.durationSec) }))
      return
    }
    // move: drop before the first clip whose middle is right of the dragged clip's middle
    const mid = p.outStart + p.outLen / 2 + d.dx / zoom
    const before = placed.find((x) => x.clip.id !== d.id && x.outStart + x.outLen / 2 > mid)?.clip.id ?? null
    editVideo((e) => {
      const moving = e.clips.find((c) => c.id === d.id)
      if (!moving) return e
      const rest = e.clips.filter((c) => c.id !== d.id)
      const i = before ? rest.findIndex((c) => c.id === before) : rest.length
      return { ...e, clips: [...rest.slice(0, i < 0 ? rest.length : i), moving, ...rest.slice(i < 0 ? rest.length : i)] }
    })
  }

  const endDrag = () => {
    if (cdrag) return endClipDrag()
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
  const clipAt = (tt: number) => vclips.find((c) => tt >= c.start && tt < c.end)
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
    const c = vclips.find((x) => x.id === clipSel) ?? clipAt(time)
    if (!c) return noClip()
    if (vclips.length <= 1) return void toast.info(t('tl.lastClip', "Can't delete the whole video — split it first"))
    editVideo((e) => ({ ...e, removed: addRemoved(e.removed, { start: c.start, end: c.end }) }))
    setClipSel(null)
  }
  const setFormat = (patch: Partial<Pick<EditState, 'aspect' | 'fitMode'>>) => editVideo((e) => ({ ...e, ...patch }))

  // selected clip settings (speed / volume / color / transition)
  const selIdx = vclips.findIndex((c) => c.id === clipSel)
  const sel = selIdx >= 0 ? vclips[selIdx] : null
  const patchClip = (patch: (c: Clip) => Clip) => {
    if (!sel) return
    editVideo((e) => ({ ...e, clips: e.clips.map((c) => (c.id === sel.id ? patch(c) : c)) }))
  }
  const setColor = (k: keyof ClipColor, v: number) => patchClip((c) => ({ ...c, color: { ...NO_COLOR, ...c.color, [k]: v } }))

  // shortcuts: Ctrl+B split, Q trim start, W trim end, Delete removes selected clip, Esc deselects
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
      else if (k === 'escape') setClipSel(null)
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
  const map = ripple ? toSrc : undefined
  const selColor = { ...NO_COLOR, ...sel?.color }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <ZoomOut className="size-3.5 text-muted-foreground" />
        <input type="range" min={2} max={400} step={1} value={zoom} onChange={(e) => setUi({ zoom: Number(e.target.value) })} className="w-28" title={t('tl.zoom', 'Zoom (Ctrl+wheel)')} />
        <ZoomIn className="size-3.5 text-muted-foreground" />
        <div className="mx-1 h-5 w-px bg-border" />
        {/* video tools */}
        {ep.edit.enabled && (
          <Toggle on={previewEdit} onClick={() => setUi({ previewEdit: !previewEdit })} title={t('tl.editedHint', 'Show the finished video: no gaps, clip order and speed applied (drag clips to move them)')}>
            <Film /> {t('tl.edited', 'Edited')}
          </Toggle>
        )}
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
            <Slider className="w-40" label={t('tl.dubVolume', 'Dub volume')} min={0} max={2} step={0.05} value={settings.globalVolume} onChange={(v) => setSetting({ globalVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
            {settings.globalVolume < 0.05 && ep.segments.some((s) => s.audioPath) && (
              <button
                className="shrink-0 rounded-md border border-destructive/60 bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
                onClick={() => setSetting({ globalVolume: 1 })}
                title={t('tl.dubMutedHint', 'Dub volume is 0%: the dub voices are silent in the preview and the export')}
              >
                {t('tl.dubMuted', 'Dub muted — set 100%')}
              </button>
            )}
            <Toggle on={settings.reverb} onClick={() => setSetting({ reverb: !settings.reverb })} title={t('tl.reverbHint', 'Add room reverb to dub voices')}>
              <Waves /> {t('tl.reverb', 'Reverb')}
            </Toggle>
          </>
        )}
        <div className="flex-1" />
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatTime(timeX ?? time)}</span>
      </div>

      {/* selected video clip: speed / volume / color / transition */}
      {sel && (
        <div className="flex h-9 shrink-0 items-center gap-3 overflow-x-auto border-b bg-primary/5 px-2 text-xs">
          <span className="shrink-0 font-semibold text-primary">
            {t('tl.clipN', 'Clip {{n}}', { n: selIdx + 1 })} <span className="font-mono font-normal text-muted-foreground">{formatTime(sel.start).slice(3, 8)}–{formatTime(sel.end).slice(3, 8)}</span>
          </span>
          <label className="flex shrink-0 items-center gap-1.5">
            <span className="text-muted-foreground">{t('tl.clipSpeed', 'Speed')}</span>
            <Select className="w-20" value={String(clipSpeed(sel))} onChange={(v) => patchClip((c) => ({ ...c, speed: Number(v) }))} options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))} />
          </label>
          <Slider className="w-36 shrink-0" label={t('tl.clipVolume', 'Volume')} min={0} max={2} step={0.05} value={sel.volume ?? 1} onChange={(v) => patchClip((c) => ({ ...c, volume: v }))} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider className="w-36 shrink-0" label={t('tl.brightness', 'Bright')} min={-0.5} max={0.5} step={0.02} value={selColor.brightness} onChange={(v) => setColor('brightness', v)} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`} />
          <Slider className="w-36 shrink-0" label={t('tl.contrast', 'Contrast')} min={0.5} max={2} step={0.05} value={selColor.contrast} onChange={(v) => setColor('contrast', v)} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider className="w-36 shrink-0" label={t('tl.saturation', 'Color')} min={0} max={2} step={0.05} value={selColor.saturation} onChange={(v) => setColor('saturation', v)} format={(v) => `${Math.round(v * 100)}%`} />
          <label className="flex shrink-0 items-center gap-1.5" title={t('tl.transitionHint', 'Transition from this clip into the next one')}>
            <span className="text-muted-foreground">{t('tl.transition', 'Transition →')}</span>
            <Select
              className="w-32"
              disabled={selIdx >= vclips.length - 1}
              value={sel.transition?.type ?? 'none'}
              onChange={(v) => patchClip(({ transition, ...c }) => (v === 'none' ? c : { ...c, transition: { type: v as TransitionType, duration: transition?.duration ?? 0.5 } }))}
              options={[{ value: 'none', label: t('tl.noTransition', 'None (cut)') }, ...TRANSITIONS.map(([v, l]) => ({ value: v, label: t(`tl.tr_${v}`, l) }))]}
            />
            {sel.transition && (
              <Select
                className="w-16"
                value={String(sel.transition.duration)}
                onChange={(v) => patchClip((c) => ({ ...c, transition: { ...c.transition!, duration: Number(v) } }))}
                options={TDURS.map((d) => ({ value: String(d), label: `${d}s` }))}
              />
            )}
          </label>
          <button
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-accent"
            title={t('tl.clipResetHint', 'Back to normal speed, volume and color; no transition')}
            onClick={() => patchClip(({ id, start, end }) => ({ id, start, end }))}
          >
            <RotateCcw className="size-3.5" /> {t('tl.clipReset', 'Reset')}
          </button>
          <div className="flex-1" />
          <button className="rounded p-1 hover:bg-accent" title={t('tl.deselect', 'Deselect (Esc)')} onClick={() => setClipSel(null)}>
            <X className="size-3.5" />
          </button>
        </div>
      )}

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
              <ThumbTrack ep={ep} zoom={zoom} scrollLeft={scrollLeft} width={viewW} b={b} total={total} toSrc={map} />
              {/* video clips: click to select, drag the edges to trim, drag the clip to move it (edited view) */}
              {placed.map((p, i) => {
                const c = p.clip
                const isSel = clipSel === c.id
                const d = cdrag?.id === c.id ? cdrag : null
                let left = p.outStart * zoom
                let width = Math.max(2, p.outLen * zoom)
                if (d?.mode === 'l') (left += d.dx), (width = Math.max(4, width - d.dx))
                if (d?.mode === 'r') width = Math.max(4, width + d.dx)
                const sp = clipSpeed(c)
                const tr = ripple ? transitionDur(vclips, i) : 0
                return (
                  <div
                    key={`${c.id}-${c.start}`}
                    className={cn(
                      'group absolute inset-y-0 rounded-sm border-2',
                      isSel ? 'border-white' : 'border-primary/70 hover:border-primary',
                      d?.mode === 'move' && 'z-10 opacity-80 shadow-lg',
                      ripple && 'cursor-grab'
                    )}
                    style={{ left, width, transform: d?.mode === 'move' ? `translateX(${d.dx}px)` : undefined }}
                    title={`${formatTime(c.start)} → ${formatTime(c.end)}${sp !== 1 ? ` · ${sp}×` : ''}`}
                    onPointerDown={(e) => {
                      if (ripple) startClipDrag(e, c.id, 'move')
                      else setClipSel(isSel ? null : c.id)
                    }}
                  >
                    <span className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 group-hover:bg-white/40" onPointerDown={(e) => startClipDrag(e, c.id, 'l')} />
                    <span className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 group-hover:bg-white/40" onPointerDown={(e) => startClipDrag(e, c.id, 'r')} />
                    {(sp !== 1 || (c.volume ?? 1) !== 1 || c.color) && width > 28 && (
                      <span className="pointer-events-none absolute left-2 top-0.5 rounded bg-black/70 px-1 font-mono text-[9px] text-white">
                        {sp !== 1 ? `${sp}×` : '•'}
                      </span>
                    )}
                    {tr > 0 && (
                      <span
                        className="pointer-events-none absolute -right-1.5 top-1/2 z-10 size-3 -translate-y-1/2 rotate-45 border border-white bg-primary"
                        title={c.transition?.type}
                      />
                    )}
                  </div>
                )
              })}
            </div>
            {/* ORIG */}
            <div className="absolute inset-x-0 bg-muted/30" style={{ top: top('ORIG'), height: TRACK_H.ORIG }}>
              <WaveTrack path={ep.stems.full ?? (ep.videoPath || undefined)} zoom={zoom} scrollLeft={scrollLeft} width={viewW} height={TRACK_H.ORIG} color="rgba(148,163,184,.75)" toSrc={map} />
            </div>
            {/* T1 subtitles */}
            <div className="absolute inset-x-0 bg-muted/20" style={{ top: top('T1'), height: TRACK_H.T1 }}>
              {visible.map(({ s, x }) => {
                const d = drag?.id === s.id ? drag : null
                const dx = d ? span({ start: d.start, end: d.end }) ?? x : x
                const isSel = selected.has(s.id)
                const c = actorColor(cast, s.actorId)
                return (
                  <div
                    key={s.id}
                    className={cn('absolute top-0.5 flex h-[calc(100%-4px)] cursor-grab items-center overflow-hidden rounded-sm border px-1 text-[11px] text-white', isSel ? 'ring-2 ring-white' : '')}
                    style={{ left: dx.start * zoom, width: Math.max(2, (dx.end - dx.start) * zoom), background: `${c}cc`, borderColor: c }}
                    title={`${formatTime(d ? d.start : s.start)} → ${formatTime(d ? d.end : s.end)}\n${s.textTarget || s.textOriginal}`}
                    onPointerDown={(e) => startDrag(e, s, 'move', x.speed)}
                    onDoubleClick={() => useUi.getState().set({ editingId: s.id, centerTab: 'dub' })}
                  >
                    <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => startDrag(e, s, 'l', x.speed)} />
                    <span className="pointer-events-none truncate font-hanuman">{s.textTarget || s.textOriginal}</span>
                    <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => startDrag(e, s, 'r', x.speed)} />
                  </div>
                )
              })}
            </div>
            {/* A1 dub clips */}
            <div className="absolute inset-x-0 bg-muted/20" style={{ top: top('A1'), height: TRACK_H.A1 }}>
              {visible
                .filter(({ s }) => s.audioPath && s.audioDur)
                .map(({ s, x }) => (
                  <div
                    key={s.id}
                    className={cn('absolute top-0.5 h-[calc(100%-4px)] rounded-sm', s.fitWarning ? 'bg-warning/80' : 'bg-emerald-500/70')}
                    style={{ left: x.start * zoom, width: Math.max(2, ((s.audioDur ?? 0) / x.speed) * zoom) }}
                    title={`${s.audioDur}s${s.fitSpeed ? ` @ ${s.fitSpeed}×` : ''}${s.fitWarning ? ' ▲' : ''}`}
                  />
                ))}
              {ep.voiceTrack && (
                <WaveTrack path={ep.voiceTrack} zoom={zoom} scrollLeft={scrollLeft} width={viewW} height={TRACK_H.A1} color="rgba(16,185,129,.8)" toSrc={map} />
              )}
            </div>
            {/* A2 instrumental / BGM */}
            <div className="absolute inset-x-0 bg-muted/30" style={{ top: top('A2'), height: TRACK_H.A2 }}>
              <WaveTrack path={ep.stems.instrumental ?? ep.edit.bgm?.path} zoom={zoom} scrollLeft={scrollLeft} width={viewW} height={TRACK_H.A2} color="rgba(139,92,246,.75)" toSrc={map} />
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
            {timeX !== null && (
              <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-500" style={{ left: timeX * zoom }}>
                <div className="absolute -left-1 top-0 size-2 rotate-45 bg-red-500" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
