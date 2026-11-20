import { useMemo } from 'react'
import type { CaptionStyle } from '@shared/types'
import { tokenize, tokenTimings } from '@shared/captions'

/** CSS approximation of the ASS caption style for live preview over the player. */
export function CaptionPreview({
  style,
  text,
  start,
  end,
  time,
  height,
  lang
}: {
  style: CaptionStyle
  text: string
  start: number
  end: number
  time: number
  /** rendered video height in px (style sizes are authored for 1080p) */
  height: number
  lang: string
}) {
  const scale = height / 1080
  const tokens = useMemo(() => tokenTimings(tokenize(text, lang), start, end), [text, start, end, lang])
  const stroke = Math.max(0, style.outline * scale)
  const shadow = style.shadow * scale
  const textShadow = style.box
    ? undefined
    : [
        ...(stroke > 0
          ? [
              `${stroke}px 0 0 ${style.outlineColor}`,
              `-${stroke}px 0 0 ${style.outlineColor}`,
              `0 ${stroke}px 0 ${style.outlineColor}`,
              `0 -${stroke}px 0 ${style.outlineColor}`,
              `${stroke * 0.7}px ${stroke * 0.7}px 0 ${style.outlineColor}`,
              `-${stroke * 0.7}px -${stroke * 0.7}px 0 ${style.outlineColor}`,
              `${stroke * 0.7}px -${stroke * 0.7}px 0 ${style.outlineColor}`,
              `-${stroke * 0.7}px ${stroke * 0.7}px 0 ${style.outlineColor}`
            ]
          : []),
        ...(shadow > 0 ? [`${shadow * 1.5}px ${shadow * 1.5}px ${shadow}px rgba(0,0,0,.6)`] : [])
      ].join(',')

  const pos =
    style.position === 'top'
      ? { top: style.marginV * scale }
      : style.position === 'middle'
        ? { top: '50%', transform: 'translateY(-50%)' }
        : { bottom: style.marginV * scale }

  let content: React.ReactNode = text
  if (style.mode === 'karaoke') {
    content = tokens.map((tk, i) => {
      const p = Math.max(0, Math.min(1, (time - tk.start) / Math.max(0.01, tk.end - tk.start)))
      return (
        <span key={i} style={{ color: p >= 1 ? style.highlight : p > 0 ? undefined : style.primary, position: 'relative' }}>
          {p > 0 && p < 1 ? (
            <span
              style={{
                backgroundImage: `linear-gradient(90deg, ${style.highlight} ${p * 100}%, ${style.primary} ${p * 100}%)`,
                WebkitBackgroundClip: 'text',
                color: 'transparent'
              }}
            >
              {tk.text}
            </span>
          ) : (
            tk.text
          )}
        </span>
      )
    })
  } else if (style.mode === 'word') {
    const cur = tokens.find((tk) => time >= tk.start && time < tk.end) ?? tokens[0]
    content = <span style={{ color: style.highlight, fontSize: '1.08em' }}>{cur?.text.trim()}</span>
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 flex justify-center px-[4%] text-center" style={pos}>
      <span
        style={{
          fontFamily: `"${style.font}", "Kantumruy Pro", "Khmer UI", sans-serif`,
          fontSize: Math.max(10, style.size * scale),
          fontWeight: style.bold ? 700 : 500,
          color: style.primary,
          textShadow,
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          background: style.box ? `${style.boxColor}bf` : undefined,
          padding: style.box ? `${4 * scale}px ${12 * scale}px` : undefined,
          borderRadius: style.box ? 4 * scale : undefined
        }}
      >
        {content}
      </span>
    </div>
  )
}
