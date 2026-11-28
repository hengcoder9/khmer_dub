import { useEffect, useRef, useState } from 'react'
import type { Overlay } from '@shared/overlays'
import { TEXT_STYLES, isVideo, textCss } from '@shared/overlays'
import { mediaUrl, post } from '@/lib/api'
import { updateEpisode } from '@/store/project'
import { cn } from '@/lib/utils'

function useFileUrl(path?: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!path) return setUrl(null)
    void post('/media/allow', { path })
      .catch(() => {})
      .then(() => mediaUrl(path))
      .then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [path])
  return url
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/**
 * Stickers and text over the video at the current time (same place and size as the export).
 * Drag to move; drag the corner handle to resize. Positions are fractions of this box (= the output frame).
 */
export function OverlayLayer({ epId, overlays, time }: { epId: string; overlays: Overlay[]; time: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; w?: number; size?: number } | null>(null)
  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setH(e.contentRect.height))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const active = overlays.filter((o) => time >= o.start && time < o.end)
  if (!active.length) return <div ref={box} className="pointer-events-none absolute inset-0" />

  const save = (id: string, patch: Partial<Overlay>) =>
    updateEpisode(epId, (e) => ({ ...e, overlays: (e.overlays ?? []).map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o)) }))

  const startMove = (o: Overlay, ev: React.PointerEvent) => {
    ev.stopPropagation()
    ev.preventDefault()
    setSel(o.id)
    const r = box.current!.getBoundingClientRect()
    const ox = ev.clientX
    const oy = ev.clientY
    let cur = { id: o.id, x: o.x, y: o.y }
    const move = (e: PointerEvent) => {
      cur = { id: o.id, x: clamp(o.x + (e.clientX - ox) / r.width, 0, 1), y: clamp(o.y + (e.clientY - oy) / r.height, 0, 1) }
      setDrag(cur)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (cur.x !== o.x || cur.y !== o.y) save(o.id, { x: cur.x, y: cur.y })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const startResize = (o: Overlay, ev: React.PointerEvent) => {
    ev.stopPropagation()
    ev.preventDefault()
    const r = box.current!.getBoundingClientRect()
    const ox = ev.clientX
    let cur: { id: string; x: number; y: number; w?: number; size?: number } = { id: o.id, x: o.x, y: o.y }
    const move = (e: PointerEvent) => {
      const d = (e.clientX - ox) / r.width
      cur = o.kind === 'sticker' ? { ...cur, w: clamp(o.w + d * 2, 0.03, 1) } : { ...cur, size: clamp(o.size + d * 0.5, 0.02, 0.4) }
      setDrag(cur)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (o.kind === 'sticker' && cur.w) save(o.id, { w: cur.w })
      if (o.kind === 'text' && cur.size) save(o.id, { size: cur.size })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" style={{ pointerEvents: 'none', containerType: 'size' }}>
      {active.map((o) => {
        const live = drag?.id === o.id ? { ...o, ...drag } : o
        return (
          <div
            key={o.id}
            className={cn('group absolute cursor-move select-none', sel === o.id && 'outline outline-2 outline-offset-2 outline-primary')}
            style={{ left: `${live.x * 100}%`, top: `${live.y * 100}%`, transform: 'translate(-50%, -50%)', opacity: o.opacity, pointerEvents: 'auto' }}
            onPointerDown={(e) => startMove(o, e)}
          >
            {o.kind === 'sticker' ? <StickerView path={o.path} widthPct={(live as typeof o).w} /> : <span style={textCss(TEXT_STYLES[o.style] ?? TEXT_STYLES.classic, Math.max(6, h * (live as typeof o).size)) as React.CSSProperties}>{o.text}</span>}
            <span
              className="absolute -bottom-2 -right-2 hidden size-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-primary group-hover:block"
              style={sel === o.id ? { display: 'block' } : undefined}
              onPointerDown={(e) => startResize(o, e)}
            />
          </div>
        )
      })}
    </div>
  )
}

function StickerView({ path, widthPct }: { path: string; widthPct: number }) {
  const url = useFileUrl(path)
  // the sticker's width is a share of the frame width: size it from the parent box via container units
  const style = { width: `calc(${(widthPct * 100).toFixed(2)}cqw)`, display: 'block' } as React.CSSProperties
  if (!url) return null
  return isVideo(path) ? <video src={url} style={style} autoPlay loop muted playsInline draggable={false} /> : <img src={url} style={style} draggable={false} />
}
