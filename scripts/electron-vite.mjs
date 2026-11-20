// Runs electron-vite with ELECTRON_RUN_AS_NODE removed. Some hosts (e.g. VS Code extensions) set it,
// which makes Electron start as plain Node so `require('electron')` has no app/ipcMain.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

delete process.env.ELECTRON_RUN_AS_NODE
const appData = process.env.APPDATA || (process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Roaming') : '')
if (appData) {
  const userDataDir = join(appData, 'KhmerDub Studio')
  const existingArgs = process.env.ELECTRON_CLI_ARGS ? JSON.parse(process.env.ELECTRON_CLI_ARGS) : []
  if (!existingArgs.some((a) => a.startsWith('--user-data-dir='))) {
    existingArgs.push(`--user-data-dir=${userDataDir}`)
  }
  process.env.ELECTRON_CLI_ARGS = JSON.stringify(existingArgs)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
if (!existsSync(cli)) {
  console.error('electron-vite not installed — run "npm install" first')
  process.exit(1)
}
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', cwd: root, env: process.env })
child.on('exit', (code) => process.exit(code ?? 0))
