import { useEffect, useState } from 'react'
import type { Voice } from '@shared/types'
import { loadVoices } from './pipeline'
import { mediaUrl } from './api'

let listeners: Array<(v: Voice[]) => void> = []
let current: Voice[] = []

export function useVoices(): [Voice[], (refresh?: boolean) => Promise<void>] {
  const [voices, setVoices] = useState<Voice[]>(current)
  useEffect(() => {
    listeners.push(setVoices)
    if (!current.length) reloadVoices().catch(() => {})
    return () => {
      listeners = listeners.filter((l) => l !== setVoices)
    }
  }, [])
  return [voices, reloadVoices]
}

export async function reloadVoices(refresh = false) {
  current = await loadVoices(refresh)
  listeners.forEach((l) => l(current))
}

/** Media URL with a cache-buster so regenerated files (same path) reload. */
export function useMediaUrl(path?: string, version?: unknown): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return setUrl(null)
    let alive = true
    mediaUrl(path).then((u) => alive && setUrl(`${u}&v=${encodeURIComponent(String(version ?? ''))}`))
    return () => {
      alive = false
    }
  }, [path, version])
  return url
}

export function voiceLabel(voices: Voice[], id?: string) {
  if (!id) return ''
  return voices.find((v) => v.id === id)?.name ?? id.replace(/^\w+:/, '')
}
