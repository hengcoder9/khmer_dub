import type { CSSProperties } from 'react'
import type { SubCover } from '@shared/types'
import { normCover, sourceRect } from '@shared/subcover'

/** Preview of "Hide old subtitles": a blurred (or solid) box over the source's burned-in subtitles, like the export. */
export function SubCoverLayer({ cover, srcAspect, boxAspect, fit = 'contain' }: { cover: SubCover; srcAspect: number; boxAspect?: number; fit?: 'contain' | 'cover' }) {
  const c = normCover(cover)
  const r = sourceRect(srcAspect, boxAspect ?? srcAspect, fit)
  // export: boxblur radius ≈ 1.2 % of the height per strength step, applied twice ≈ a gaussian of ~0.85 % per step
  const area: CSSProperties =
    c.mode === 'box'
      ? { background: c.color ?? '#000000', opacity: c.opacity }
      : { backdropFilter: `blur(${(0.85 * (c.strength ?? 2)).toFixed(2)}cqh)`, WebkitBackdropFilter: `blur(${(0.85 * (c.strength ?? 2)).toFixed(2)}cqh)` }
  return (
    <div className="pointer-events-none absolute" style={{ left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%`, containerType: 'size' }}>
      <div className="absolute" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%`, ...area }} />
    </div>
  )
}
