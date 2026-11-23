import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { KdApi, UpdateInfo } from '../shared/types'

const api: KdApi = {
  getBackend: () => ipcRenderer.invoke('backend:get'),
  openFile: (opts) => ipcRenderer.invoke('dialog:openFile', opts),
  openFiles: (opts) => ipcRenderer.invoke('dialog:openFiles', opts),
  openDir: (opts) => ipcRenderer.invoke('dialog:openDir', opts),
  saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  account: {
    state: () => ipcRenderer.invoke('account:state'),
    call: (path, body) => ipcRenderer.invoke('account:call', path, body),
    setServer: (url) => ipcRenderer.invoke('account:setServer', url),
    signOutLocal: () => ipcRenderer.invoke('account:signOutLocal'),
    openAdmin: () => ipcRenderer.invoke('account:openAdmin'),
    openPayUrl: (url) => ipcRenderer.invoke('account:openPayUrl', url)
  },
  setZoom: (f) => webFrame.setZoomFactor(Math.max(0.6, Math.min(2, f))),
  keys: {
    list: () => ipcRenderer.invoke('keys:list'),
    add: (provider, key, label) => ipcRenderer.invoke('keys:add', provider, key, label),
    remove: (id) => ipcRenderer.invoke('keys:remove', id),
    sync: () => ipcRenderer.invoke('keys:sync')
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => {
      const h = (_e: unknown, u: UpdateInfo) => cb(u)
      ipcRenderer.on('update:status', h)
      return () => ipcRenderer.removeListener('update:status', h)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
