import { useEffect, useState } from 'react'
import { backend } from '@/lib/api'

export function useBackendThumb(path: string, t: number, w = 128): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    backend().then((b) => alive && setSrc(`http://127.0.0.1:${b.port}/media/thumb?path=${encodeURIComponent(path)}&t=${t.toFixed(1)}&w=${w}&token=${b.token}`))
    return () => {
      alive = false
    }
  }, [path, t, w])
  return src
}
