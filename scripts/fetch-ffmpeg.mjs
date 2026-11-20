// Downloads a static Windows ffmpeg build into resources/bin/.
// Usage: npm run fetch:ffmpeg [-- --force]     Override source with FFMPEG_URL=...
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const STALL_MS = 30_000

/** Newest numbered (non-master, non-shared) win64 GPL build from BtbN; asset names change with each ffmpeg release. */
async function latestBtbN() {
  const res = await fetch('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest', {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'fetch-ffmpeg-script' },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`)
  const { assets } = await res.json()
  const ver = (n) => n.match(/-n(\d+)\.(\d+)/).slice(1).map(Number)
  const builds = assets
    .filter((a) => /^ffmpeg-n\d+\.\d+-latest-win64-gpl-\d+\.\d+\.zip$/.test(a.name))
    .sort((a, b) => {
      const [x, y] = [ver(a.name), ver(b.name)]
      return y[0] - x[0] || y[1] - x[1]
    })
  if (!builds.length) throw new Error('No matching BtbN asset')
  return builds[0].browser_download_url
}

async function sources() {
  if (process.env.FFMPEG_URL) return [process.env.FFMPEG_URL]
  const list = []
  try {
    list.push(await latestBtbN())
  } catch (e) {
    console.warn(`Couldn't query GitHub (${e.message})`)
  }
  list.push('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip') // fallback, can be slow
  return list
}

/** Download with progress; aborts if no bytes arrive for STALL_MS. */
async function download(url, dest) {
  const ctrl = new AbortController()
  let timer = setTimeout(() => ctrl.abort(), STALL_MS)
  const res = await fetch(url, { signal: ctrl.signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  let lastLog = 0
  const counted = Readable.fromWeb(res.body).on('data', (chunk) => {
    got += chunk.length
    clearTimeout(timer)
    timer = setTimeout(() => ctrl.abort(), STALL_MS)
    if (Date.now() - lastLog > 2000) {
      lastLog = Date.now()
      const mb = (got / 1048576).toFixed(1)
      console.log(total ? `  ${mb} / ${(total / 1048576).toFixed(1)} MB` : `  ${mb} MB`)
    }
  })
  try {
    await pipeline(counted, createWriteStream(dest))
  } finally {
    clearTimeout(timer)
  }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const binDir = join(root, 'resources', 'bin')
const targets = ['ffmpeg.exe', 'ffprobe.exe']

if (targets.every((t) => existsSync(join(binDir, t))) && !process.argv.includes('--force')) {
  console.log('ffmpeg already present in resources/bin (use --force to re-download).')
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'kd-ffmpeg-'))
try {
  const zip = join(work, 'ffmpeg.zip')
  let ok = false
  for (const url of await sources()) {
    console.log(`Downloading ${url}`)
    try {
      await download(url, zip)
      ok = true
      break
    } catch (e) {
      console.warn(`  failed (${e.name === 'AbortError' ? 'stalled' : e.message}), trying next source…`)
    }
  }
  if (!ok) throw new Error('All download sources failed. Set FFMPEG_URL to a Windows ffmpeg .zip and retry.')
  console.log(`Downloaded ${(statSync(zip).size / 1024 / 1024).toFixed(1)} MB, extracting…`)

  // Windows' bundled bsdtar can unpack zip files (GNU tar from Git Bash can't).
  const sysTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  const out = join(work, 'x')
  mkdirSync(out)
  const r = spawnSync(existsSync(sysTar) ? sysTar : 'tar', ['-xf', zip, '-C', out], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('Extraction failed')

  const find = (dir, name) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        const hit = find(p, name)
        if (hit) return hit
      } else if (e.name.toLowerCase() === name) return p
    }
    return null
  }
  mkdirSync(binDir, { recursive: true })
  for (const t of targets) {
    const src = find(out, t)
    if (!src) throw new Error(`${t} not found in archive`)
    copyFileSync(src, join(binDir, t))
    console.log(`✔ ${t}`)
  }
  console.log(`Done → ${binDir}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
