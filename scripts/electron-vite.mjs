// Runs electron-vite with ELECTRON_RUN_AS_NODE removed. Some hosts (e.g. VS Code extensions) set it,
// which makes Electron start as plain Node so `require('electron')` has no app/ipcMain.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

delete process.env.ELECTRON_RUN_AS_NODE
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
if (!existsSync(cli)) {
  console.error('electron-vite not installed — run "npm install" first')
  process.exit(1)
}
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', cwd: root, env: process.env })
child.on('exit', (code) => process.exit(code ?? 0))
