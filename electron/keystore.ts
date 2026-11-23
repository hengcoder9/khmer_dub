// API keys encrypted with the OS key store (Windows DPAPI via Electron safeStorage). Never written in plain text.

import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { KeyEntry } from '../shared/types'

interface Stored {
  id: string
  provider: KeyEntry['provider']
  label?: string
  enc: string // base64 ciphertext
  /** id of the copy saved on the account server */
  sid?: number
}

/** keys the admin shares with active accounts — memory only, never written to disk */
let shared: Array<{ id: number; provider: KeyEntry['provider']; label?: string; key: string }> = []
export const setSharedKeys = (list: typeof shared) => (shared = list)

const file = () => join(app.getPath('userData'), 'keys.dat')

function load(): Stored[] {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Stored[]) : []
  } catch {
    return []
  }
}

const save = (list: Stored[]) => writeFileSync(file(), JSON.stringify(list), 'utf8')

const mask = (k: string) => (k.length <= 10 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`)

function decrypt(s: Stored): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(s.enc, 'base64'))
  } catch {
    return null
  }
}

export function listKeys(): KeyEntry[] {
  const out: KeyEntry[] = []
  for (const s of load()) {
    const k = decrypt(s)
    if (k) out.push({ id: s.id, provider: s.provider, label: s.label, masked: mask(k) })
  }
  for (const k of shared) out.push({ id: `s${k.id}`, provider: k.provider, label: k.label || undefined, masked: mask(k.key), shared: true })
  return out
}

/** Plain keys for the backend process (in memory only). */
export function plainKeys(): Array<{ id: string; provider: KeyEntry['provider']; key: string }> {
  return load()
    .map((s) => ({ id: s.id, provider: s.provider, key: decrypt(s) ?? '' }))
    .filter((k) => k.key)
    .concat(shared.map((k) => ({ id: `s${k.id}`, provider: k.provider, key: k.key })))
}

export function addKey(provider: KeyEntry['provider'], key: string, label?: string): KeyEntry[] {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('Empty key')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available; cannot store keys safely')
  const list = load()
  // ignore duplicates
  if (list.some((s) => s.provider === provider && decrypt(s) === trimmed)) return listKeys()
  list.push({ id: randomBytes(6).toString('hex'), provider, label: label?.trim() || undefined, enc: safeStorage.encryptString(trimmed).toString('base64') })
  save(list)
  return listKeys()
}

export function removeKey(id: string): KeyEntry[] {
  if (id.startsWith('s')) return listKeys() // shared keys belong to the admin
  save(load().filter((s) => s.id !== id))
  return listKeys()
}

/** Local keys with their server ids, for syncing. */
export function localKeys(): Array<{ id: string; provider: KeyEntry['provider']; label?: string; key: string; sid?: number }> {
  return load()
    .map((s) => ({ id: s.id, provider: s.provider, label: s.label, key: decrypt(s) ?? '', sid: s.sid }))
    .filter((k) => k.key)
}

export function setServerId(id: string, sid: number): void {
  save(load().map((s) => (s.id === id ? { ...s, sid } : s)))
}

/** Server id of a local key (so removing it here removes the saved copy too). */
export const serverIdOf = (id: string): number | undefined => load().find((s) => s.id === id)?.sid

/** Add a key that came from the server (already saved there). */
export function addFromServer(provider: KeyEntry['provider'], key: string, label: string, sid: number): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const list = load()
  const hit = list.find((s) => s.provider === provider && decrypt(s) === key)
  if (hit) hit.sid = sid
  else list.push({ id: randomBytes(6).toString('hex'), provider, label: label || undefined, enc: safeStorage.encryptString(key).toString('base64'), sid })
  save(list)
}
