import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** resources/ in dev, process.resourcesPath when packaged (passed in by electron main). */
export const resourcesDir = process.env.KD_RESOURCES ?? join(process.cwd(), 'resources')
export const userDataDir = process.env.KD_USER_DATA ?? join(process.cwd(), '.userdata')
export const documentsDir = process.env.KD_DOCUMENTS ?? join(homedir(), 'Documents')
export const binDir = join(resourcesDir, 'bin')
export const fontsDir = join(resourcesDir, 'fonts')
/** workers/ sits next to resources in dev; packaged it is copied into resources/workers */
export const workersDir = existsSync(join(resourcesDir, 'workers'))
  ? join(resourcesDir, 'workers')
  : join(resourcesDir, '..', 'workers')

export const pythonEnvDir = join(userDataDir, 'python')
export const modelsDir = join(userDataDir, 'models')
export const cacheDir = join(userDataDir, 'cache')
export const voicesDir = join(userDataDir, 'voices')
export const logsDir = join(userDataDir, 'logs')
export const projectsRoot = join(documentsDir, 'KhmerDub Projects')

for (const d of [modelsDir, cacheDir, voicesDir, logsDir]) mkdirSync(d, { recursive: true })

const bundled = (name: string) => join(binDir, `${name}.exe`)

/** Bundled binary if present, else fall back to whatever is on PATH. */
export function binPath(name: 'ffmpeg' | 'ffprobe' | 'yt-dlp'): { path: string; bundled: boolean } {
  const p = bundled(name)
  return existsSync(p) ? { path: p, bundled: true } : { path: name, bundled: false }
}

/** Python used for AI workers: explicit override → bundled resources/python → app-installed env. */
export function pythonPath(): string | null {
  const candidates = [process.env.KD_PYTHON, join(resourcesDir, 'python', 'python.exe'), join(pythonEnvDir, 'python.exe')]
  for (const c of candidates) if (c && existsSync(c)) return c
  return null
}
