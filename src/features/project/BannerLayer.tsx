import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AdBanner } from '@shared/types'
import { bannerVisible } from '@shared/ads'
import { mediaUrl, post } from '@/lib/api'

const place = (b: AdBanner): CSSProperties => {
  const m = `${(b.margin * 100).toFixed(2)}cqmin`
  switch (b.position) {
    case 'top':
      return { top: m, left: '50%', transform: 'translateX(-50%)' }
    case 'bottom':
      return { bottom: m, left: '50%', transform: 'translateX(-50%)' }
    case 'center':
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    case 'tl':
      return { top: m, left: m }
    case 'tr':
      return { top: m, right: m }
    case 'bl':
      return { bottom: m, left: m }
    default:
      return { bottom: m, right: m }
  }
}

/** URL a banner image can be shown from (the backend must allow the file first). */
export function useBannerUrl(path?: string): string | null {
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

function One({ b, time, always }: { b: AdBanner; time: number; always?: boolean }) {
  const url = useBannerUrl(b.path)
  if (!url || (!always && !bannerVisible(b, time))) return null
  return <img src={url} className="absolute" style={{ ...place(b), width: `${(b.size * 100).toFixed(1)}cqw`, opacity: b.opacity }} />
}

/** Banner ads over the video, on the same schedule as the export (`always` = show them all, e.g. while editing). */
export function BannerLayer({ banners, time, always }: { banners: AdBanner[]; time: number; always?: boolean }) {
  const on = banners.filter((b) => b.enabled && b.path)
  if (!on.length) return null
  return (
    <div className="pointer-events-none absolute inset-0" style={{ containerType: 'size' }}>
      {on.map((b) => (
        <One key={b.id} b={b} time={time} always={always} />
      ))}
    </div>
  )
}
