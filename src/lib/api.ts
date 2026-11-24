import type { BackendInfo } from '@shared/types'
import { hasAccess, useAccount } from '@/store/account'
import { useUi } from '@/store/ui'

let info: Promise<BackendInfo> | null = null

export const backend = () => (info ??= window.api.getBackend())

/** Forget the cached port/token (the backend restarted on a new port); the next call asks the main process again. */
export const resetBackend = () => {
  info = null
}

const base = (b: BackendInfo) => `http://127.0.0.1:${b.port}`

/** JSON call to the local backend. Retries once with fresh port/token if the backend restarted. */
export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  // AI helpers (AI editor, creator, shorten, story…) need an active plan, like AI jobs
  if (path.startsWith('/ai/') && !hasAccess()) {
    useUi.getState().set({ dialog: 'account' })
    throw new Error(useAccount.getState().signedIn ? 'Your free trial or plan has ended — choose a plan to keep using the AI tools.' : 'Sign in (free 3-day trial) to use the AI tools.')
  }
  const b = await backend()
  let res: Response
  try {
    res = await fetch(base(b) + path, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        'x-kd-token': b.token,
        ...init.headers
      }
    })
  } catch (e) {
    if (retried) throw e
    info = null
    return api<T>(path, init, true)
  }
  if (res.status === 401 && !retried) {
    info = null
    return api<T>(path, init, true)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const post = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) })

/** URL a <video>/<audio> element can stream (supports seeking via HTTP Range). */
export async function mediaUrl(path: string): Promise<string> {
  const b = await backend()
  return `${base(b)}/media/file?path=${encodeURIComponent(path)}&token=${b.token}`
}
