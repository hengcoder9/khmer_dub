// Which files the renderer may stream/read: files the user picked, plus anything under opened project folders.

import { resolve, sep } from 'node:path'
import { cacheDir, voicesDir } from './paths'

const files = new Set<string>()
const dirs = new Set<string>([resolve(cacheDir).toLowerCase(), resolve(voicesDir).toLowerCase()])

const norm = (p: string) => resolve(p).toLowerCase()

export const allowFile = (p: string) => files.add(norm(p))
export const allowDir = (p: string) => dirs.add(norm(p))

export function isAllowed(p: string): boolean {
  const n = norm(p)
  if (files.has(n)) return true
  for (const d of dirs) if (n === d || n.startsWith(d.endsWith(sep) ? d : d + sep)) return true
  return false
}
