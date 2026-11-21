// Downloads the latest yt-dlp.exe (official GitHub release) into resources/bin/ — used by Import Link for video pages.
// Usage: npm run fetch:ytdlp [-- --force]     Override source with YTDLP_URL=...
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const URL = process.env.YTDLP_URL ?? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const binDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'bin')
const dest = join(binDir, 'yt-dlp.exe')

if (existsSync(dest) && !process.argv.includes('--force')) {
  console.log('yt-dlp.exe already present in resources/bin (use --force to update it).')
  process.exit(0)
}

mkdirSync(binDir, { recursive: true })
const tmp = `${dest}.download`
console.log(`Downloading ${URL}`)
const res = await fetch(URL, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) })
if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
try {
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
  if (statSync(tmp).size < 1_000_000) throw new Error('Download too small — not a yt-dlp build')
  renameSync(tmp, dest)
} catch (e) {
  if (existsSync(tmp)) unlinkSync(tmp)
  throw e
}
console.log(`✔ yt-dlp.exe (${(statSync(dest).size / 1048576).toFixed(1)} MB) → ${binDir}`)
