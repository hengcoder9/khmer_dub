// Studio account: sign-in token (encrypted with Windows DPAPI via safeStorage) + last known access, kept in main.
// The renderer never sees the token; it asks main to call the account server for it.

import { app, safeStorage, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { ACCOUNT_SERVER, type AccountState } from '../shared/types'

interface Stored {
  server: string
  enc?: string // encrypted session token
  user?: AccountState['user']
  access?: AccountState['access']
  checkedAt?: number
}

const file = () => join(app.getPath('userData'), 'account.json')

function load(): Stored {
  try {
    if (existsSync(file())) return { server: ACCOUNT_SERVER, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Stored>) }
  } catch {
    /* fall through */
  }
  return { server: ACCOUNT_SERVER }
}
const save = (s: Stored) => writeFileSync(file(), JSON.stringify(s), 'utf8')

function token(s: Stored): string | null {
  if (!s.enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(s.enc, 'base64'))
  } catch {
    return null
  }
}

const device = () => `${hostname()} · ${app.getName()} ${app.getVersion()}`

export function accountState(): AccountState {
  const s = load()
  return { server: s.server, signedIn: !!token(s), user: s.user ?? null, access: s.access ?? null, checkedAt: s.checkedAt ?? 0 }
}

export function setAccountServer(url: string): AccountState {
  let u = url.trim()
  if (!/^https?:\/\//i.test(u)) throw new Error('Server URL must start with http:// or https://')
  if (!u.endsWith('/')) u += '/'
  // a different server means a different account
  save({ server: u })
  return accountState()
}

export function signOutLocal(): AccountState {
  const s = load()
  save({ server: s.server })
  return accountState()
}

// renderer may call these routes only (never the admin API)
const ALLOWED = /^(health|plans|me|me\/history|redeem|auth\/(login|register|logout|password|methods|ext\/start|ext\/poll)|pay\/(create|status|cancel))(\?[\w=&.-]*)?$/

/** Call the account server as the signed-in user. Stores the session on login/register, clears it on 401. */
export async function accountCall(path: string, body?: unknown, trusted = false): Promise<unknown> {
  if (!trusted && !ALLOWED.test(path)) throw new Error(`Not allowed: ${path}`)
  const s = load()
  const tok = token(s)
  // routes that answer with a new session token (Google / Telegram: the poll after the browser sign-in)
  const isAuth = /^auth\/(login|register|ext\/poll)$/.test(path)
  const payload = isAuth ? { ...(body as object), device: device() } : body
  let res: Response
  try {
    res = await fetch(s.server + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(tok && !isAuth ? { authorization: `Bearer ${tok}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000)
    })
  } catch (e) {
    throw Object.assign(new Error(`Cannot reach the account server (${s.server}). Check your internet connection.`), { offline: true, cause: e })
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; token?: string; user?: Stored['user']; access?: Stored['access'] }
  if (res.status === 401 && !isAuth) {
    save({ server: s.server })
    throw Object.assign(new Error(data.error ?? 'Signed out'), { signedOut: true })
  }
  if (!res.ok) throw new Error(data.error ?? `Account server error ${res.status}`)

  if (isAuth && data.token) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows could not encrypt the sign-in. Try again.')
    save({ server: s.server, enc: safeStorage.encryptString(data.token).toString('base64'), user: data.user, access: data.access, checkedAt: Date.now() })
    delete data.token
  } else if (path === 'auth/logout') {
    save({ server: s.server })
  } else if (data.user && data.access) {
    // any reply with user + access refreshes the offline cache
    save({ ...load(), user: data.user, access: data.access, checkedAt: Date.now() })
  }
  return data
}

/** Admin panel lives next to the API: …/khmerdub/api/ → …/khmerdub/admin/ */
export function openAdminPanel(): void {
  const s = load()
  void shell.openExternal(new URL('../admin/', s.server).href)
}

export function openPayUrl(url: string): void {
  if (/^https:\/\//i.test(url)) void shell.openExternal(url)
}

export const isSignedIn = (): boolean => !!token(load())
