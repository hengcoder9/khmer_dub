import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** 83.456 → "00:01:23.45" */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const cs = Math.floor((sec % 1) * 100)
  const s = Math.floor(sec) % 60
  const m = Math.floor(sec / 60) % 60
  const h = Math.floor(sec / 3600)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(s)}.${p(cs)}`
}

export const formatGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`

/** True when a key event happens inside a text field, so global shortcuts should ignore it. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}
