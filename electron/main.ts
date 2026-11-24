import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { APP_NAME, type BackendInfo, type FileFilter, type KeyEntry } from '../shared/types'
import { addKey, listKeys, plainKeys, removeKey, serverIdOf } from './keystore'
import { forgetKey, syncKeys } from './keysync'
import { checkForUpdates, downloadUpdate, initUpdater, installUpdate } from './updater'
import { accountCall, accountState, openAdminPanel, openPayUrl, setAccountServer, signOutLocal } from './account'

let win: BrowserWindow | null = null
let backend: UtilityProcess | null = null
let backendInfo: BackendInfo | null = null
let waiters: Array<(i: BackendInfo) => void> = []
let quitting = false

const resourcesDir = () => (app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'))

const pushKeys = () => {
  const keys = plainKeys()
  // counts only — never log key material
  console.log(`[keys] sending ${keys.length} key(s) to backend (gemini ${keys.filter((k) => k.provider === 'gemini').length}), backend ${backend ? 'up' : 'DOWN'}`)
  backend?.postMessage({ type: 'keys', keys })
}

function startBackend(): void {
  const token = randomBytes(24).toString('hex')
  backendInfo = null
  // utilityProcess rejects undefined values, so copy only defined strings
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string' && !['ELECTRON_RUN_AS_NODE', 'PORT', 'HOST'].includes(k)) env[k] = v
  Object.assign(env, {
    KD_TOKEN: token,
    KD_RESOURCES: resourcesDir(),
    KD_USER_DATA: app.getPath('userData'),
    KD_DOCUMENTS: app.getPath('documents')
  })
  const child = utilityProcess.fork(join(__dirname, 'server.js'), [], { serviceName: `${APP_NAME} Backend`, stdio: 'pipe', env })
  child.stdout?.on('data', (d) => process.stdout.write(`[backend] ${d}`))
  child.stderr?.on('data', (d) => process.stderr.write(`[backend] ${d}`))
  child.on('message', (msg: { type?: string; port?: number }) => {
    if (msg?.type === 'ready' && msg.port) {
      backendInfo = { port: msg.port, token }
      pushKeys()
      waiters.splice(0).forEach((resolve) => resolve(backendInfo!))
    }
  })
  child.on('exit', (code) => {
    backend = null
    backendInfo = null
    if (!quitting) {
      console.error(`[backend] exited with code ${code}, restarting…`)
      setTimeout(startBackend, 1000)
    }
  })
  backend = child
}

const getBackend = (): Promise<BackendInfo> =>
  backendInfo ? Promise.resolve(backendInfo) : new Promise((resolve) => waiters.push(resolve))

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: join(resourcesDir(), 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => {
    win?.maximize()
    win?.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => (win = null))
  initUpdater(win)
  if (!app.isPackaged && process.env.KD_SHOTS) runShots(win)
}

/** Dev-only UI smoke test: KD_SHOTS='[{"js":"…","wait":2000,"shot":"name"}]' KD_SHOT_DIR=… */
function runShots(w: BrowserWindow) {
  const steps = JSON.parse(process.env.KD_SHOTS!) as Array<{ js?: string; wait?: number; shot?: string }>
  const dir = process.env.KD_SHOT_DIR ?? app.getPath('temp')
  w.webContents.once('did-finish-load', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    await sleep(2500)
    for (const s of steps) {
      try {
        if (s.js) await w.webContents.executeJavaScript(s.js)
      } catch (e) {
        console.error('[shots] step failed:', e)
      }
      await sleep(s.wait ?? 1500)
      if (s.shot) {
        const img = await w.webContents.capturePage()
        writeFileSync(join(dir, `${s.shot}.png`), img.toPNG())
        console.log(`[shots] ${s.shot}.png`)
      }
    }
    if (process.env.KD_SHOTS_QUIT) app.quit()
  })
}

type DialogOpts = { title?: string; filters?: FileFilter[]; defaultPath?: string }

ipcMain.handle('backend:get', () => getBackend())
ipcMain.handle('app:info', () => ({ name: APP_NAME, version: app.getVersion(), documents: app.getPath('documents') }))
ipcMain.handle('dialog:openFile', async (_e, o: DialogOpts = {}) => {
  const r = await dialog.showOpenDialog(win!, { title: o.title, filters: o.filters, properties: ['openFile'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('dialog:openFiles', async (_e, o: DialogOpts = {}) => {
  const r = await dialog.showOpenDialog(win!, { title: o.title, filters: o.filters, properties: ['openFile', 'multiSelections'] })
  return r.canceled ? [] : r.filePaths
})
ipcMain.handle('dialog:openDir', async (_e, o: DialogOpts = {}) => {
  const r = await dialog.showOpenDialog(win!, { title: o.title, properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('dialog:saveFile', async (_e, o: DialogOpts = {}) => {
  const r = await dialog.showSaveDialog(win!, o)
  return r.canceled ? null : r.filePath
})
ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))
// only media/subtitle outputs — never executables
ipcMain.handle('shell:openPath', (_e, p: string) =>
  /\.(mp4|mkv|mov|wav|mp3|srt|vtt|ass)$/i.test(p) ? shell.openPath(p) : Promise.resolve('blocked file type')
)

ipcMain.handle('account:state', () => accountState())
ipcMain.handle('account:call', async (_e, path: string, body?: unknown) => {
  try {
    const data = await accountCall(path, body)
    // signing in or out changes which shared keys this PC may use
    // (Google / Telegram: the poll that finally returns the account)
    if (/^auth\/(login|register|logout)$/.test(path) || (path === 'auth/ext/poll' && (data as { user?: unknown })?.user)) void resyncKeys()
    return { ok: true, data }
  } catch (e) {
    const err = e as Error & { offline?: boolean; signedOut?: boolean }
    return { ok: false, error: err.message, offline: !!err.offline, signedOut: !!err.signedOut }
  }
})
ipcMain.handle('account:setServer', (_e, url: string) => setAccountServer(url))
ipcMain.handle('account:signOutLocal', () => {
  const r = signOutLocal()
  void resyncKeys()
  return r
})
ipcMain.handle('account:openAdmin', () => openAdminPanel())
ipcMain.handle('account:openPayUrl', (_e, url: string) => openPayUrl(url))

const resyncKeys = async () => {
  if (await syncKeys()) pushKeys()
}
ipcMain.handle('keys:sync', async () => {
  await resyncKeys()
  return listKeys()
})
ipcMain.handle('keys:list', () => listKeys())
ipcMain.handle('keys:add', (_e, provider: KeyEntry['provider'], key: string, label?: string) => {
  const r = addKey(provider, key, label)
  pushKeys()
  void resyncKeys() // back it up to the account
  return r
})
ipcMain.handle('keys:remove', (_e, id: string) => {
  const sid = serverIdOf(id)
  const r = removeKey(id)
  pushKeys()
  void forgetKey(sid)
  return r
})

ipcMain.handle('update:check', () => checkForUpdates())
ipcMain.handle('update:download', () => downloadUpdate())
ipcMain.handle('update:install', () => {
  quitting = true
  installUpdate()
})

app.name = APP_NAME
app.setPath('userData', join(app.getPath('appData'), APP_NAME))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(() => {
    app.setAppUserModelId('com.khmerdub.studio')
    startBackend()
    createWindow()
    // shared keys from the admin + your saved keys: now, and every 10 minutes (a plan ending stops the shared keys)
    void resyncKeys()
    setInterval(() => void resyncKeys(), 10 * 60_000)
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
  })
}

// Ask the backend to stop its Python workers first, then kill it.
app.on('before-quit', (e) => {
  if (quitting || !backend) return
  quitting = true
  e.preventDefault()
  const b = backend
  b.postMessage({ type: 'shutdown' })
  const done = () => app.quit()
  b.once('exit', done)
  setTimeout(() => {
    b.kill()
    done()
  }, 2500)
})
app.on('window-all-closed', () => app.quit())
