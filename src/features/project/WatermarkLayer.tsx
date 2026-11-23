import type { CSSProperties } from 'react'
import type { Watermark } from '@shared/types'

/**
 * Watermark preview (logo and/or text) with the same animations as the export, drawn over a video box.
 * Sizes use container units (cqmin = shorter side, cqw = width) so the preview matches the exported frame.
 */
export function WatermarkLayer({ wm, imageUrl }: { wm: Watermark; imageUrl: string | null; heightPx?: number }) {
  const anim = wm.animation ?? 'none'
  const every = Math.max(2, Math.min(60, wm.every ?? 8))
  const m = `${(wm.margin * 100).toFixed(2)}cqmin`
  const top = wm.position[0] === 't'
  const bottom = wm.position[0] === 'b'
  const left = wm.position === 'tl' || wm.position === 'bl'
  const text = wm.text?.trim()

  // block placement (corner / row) — export: text below the logo at the top, above it at the bottom
  const place: CSSProperties =
    anim === 'scroll'
      ? { top: top ? m : bottom ? undefined : '50%', bottom: bottom ? m : undefined, left: '100%' }
      : wm.position === 'center'
        ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
        : { [top ? 'top' : 'bottom']: m, [left ? 'left' : 'right']: m }

  const animation: Record<string, string | undefined> = {
    none: undefined,
    pulse: `kdwm-pulse ${every}s ease-in-out infinite`,
    corners: `kdwm-corners ${every * 4}s steps(1, end) infinite`,
    scroll: `kdwm-scroll ${every}s linear infinite`,
    float: `kdwm-float ${every}s ease-in-out infinite`
  }
  return (
    <div className="pointer-events-none absolute inset-0" style={{ containerType: 'size' }}>
      <style>{`
        @keyframes kdwm-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
        @keyframes kdwm-scroll { from { left: 100%; transform: none } to { left: 0; transform: translateX(-100%) } }
        @keyframes kdwm-float { 0%,100% { translate: 0 0 } 25% { translate: 2cqmin 0 } 50% { translate: 2cqmin 2cqmin } 75% { translate: 0 2cqmin } }
        @keyframes kdwm-corners {
          0% { top: ${m}; left: ${m}; right: auto; bottom: auto; transform: none }
          25% { top: ${m}; left: calc(100% - ${m}); transform: translateX(-100%) }
          50% { top: calc(100% - ${m}); left: calc(100% - ${m}); transform: translate(-100%, -100%) }
          75% { top: calc(100% - ${m}); left: ${m}; transform: translateY(-100%) }
        }
      `}</style>
      <div
        className="absolute flex gap-[1cqmin]"
        style={{
          ...(anim === 'corners' ? { top: m, left: m } : place),
          flexDirection: bottom && anim !== 'corners' ? 'column-reverse' : 'column',
          alignItems: anim === 'corners' ? 'flex-start' : wm.position === 'center' ? 'center' : left ? 'flex-start' : 'flex-end',
          opacity: wm.opacity,
          animation: animation[anim],
          whiteSpace: 'nowrap'
        }}
      >
        {wm.path && imageUrl && <img src={imageUrl} draggable={false} style={{ width: `${wm.size * 100}cqw`, height: 'auto' }} />}
        {text && (
          <span
            className="font-hanuman font-bold leading-tight"
            style={{
              color: wm.textColor ?? '#FFFFFF',
              fontSize: `${((wm.textSize ?? 0.045) * 100).toFixed(2)}cqmin`,
              textShadow: '0 0 2px #000, 0 0 2px #000, 1px 1px 2px #000'
            }}
          >
            {text}
          </span>
        )}
      </div>
    </div>
  )
}
