// Auto-update from GitHub Releases (configured in electron-builder.yml → publish).

import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from '../shared/types'

let state: UpdateInfo = { state: 'idle', current: app.getVersion() }
let win: BrowserWindow | null = null

function set(patch: Partial<UpdateInfo>) {
  state = { ...state, ...patch, current: app.getVersion() }
  win?.webContents.send('update:status', state)
}

const notesText = (n: unknown): string | undefined => {
  if (!n) return undefined
  if (typeof n === 'string') return n.replace(/<[^>]+>/g, '').trim()
  if (Array.isArray(n)) return n.map((x: { version?: string; note?: string }) => `${x.version ?? ''}\n${(x.note ?? '').replace(/<[^>]+>/g, '')}`).join('\n\n')
  return undefined
}

export function initUpdater(w: BrowserWindow) {
  win = w
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
  autoUpdater.on('update-available', (i) => set({ state: 'available', version: i.version, notes: notesText(i.releaseNotes) }))
  autoUpdater.on('update-not-available', () => set({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', () => set({ state: 'ready', percent: 100 }))
  autoUpdater.on('error', (e) => set({ state: 'error', error: e?.message ?? String(e) }))
  // quiet check shortly after start (installed builds only)
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000)
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  if (!app.isPackaged) {
    set({ state: 'none', error: 'Updates are checked only in the installed app.' })
    return state
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ state: 'error', error: (e as Error).message })
  }
  return state
}

export const downloadUpdate = () => autoUpdater.downloadUpdate().then(() => undefined)
export const installUpdate = () => autoUpdater.quitAndInstall()
