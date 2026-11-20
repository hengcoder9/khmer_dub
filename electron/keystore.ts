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
}

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
  return out
}

/** Plain keys for the backend process (in memory only). */
export function plainKeys(): Array<{ id: string; provider: KeyEntry['provider']; key: string }> {
  return load()
    .map((s) => ({ id: s.id, provider: s.provider, key: decrypt(s) ?? '' }))
    .filter((k) => k.key)
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
  save(load().filter((s) => s.id !== id))
  return listKeys()
}
