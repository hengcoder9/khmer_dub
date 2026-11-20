// "Import Link": download a video file the user owns or is licensed to use (direct file, Google Drive, Dropbox).
// Streaming / VIP platforms are refused on purpose: their episodes are licensed to them and copy-protected.

import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { JobCtx } from '../queue'

export interface DownloadPayload {
  url: string
  outDir: string
}

/** Paywalled / DRM streaming services (drama apps and video platforms). */
const BLOCKED = [
  'iq.com', 'iqiyi.com', 'wetv.vip', 'v.qq.com', 'qq.com', 'hongguoduanju.com', 'dramabox', 'goodshort',
  'youku.com', 'mgtv.com', 'bilibili.com', 'netflix.com', 'viu.com', 'disneyplus.com', 'primevideo.com', 'reelshort', 'shortmax', 'flextv'
]
/** Need the platform's own download (e.g. YouTube Studio → Download) — not scraped here. */
const PLATFORM = ['youtube.com', 'youtu.be', 'tiktok.com', 'facebook.com', 'fb.watch', 'instagram.com', 'douyin.com', 'kuaishou.com']

const VIDEO_EXT = /\.(mp4|m4v|mkv|mov|webm|avi)$/i

export function resolveLink(raw: string): { url: string; kind: 'direct' | 'gdrive' | 'dropbox' } {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error('That is not a valid link. Paste a full https:// link to a video file.')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) links are supported.')
  const host = u.hostname.toLowerCase()
  const on = (list: string[]) => list.some((d) => host === d || host.endsWith('.' + d) || (!d.includes('.') && host.includes(d)))
  if (on(BLOCKED)) {
    throw new Error(
      `${host} is a streaming / VIP service: its episodes are licensed to that platform and copy-protected, so KhmerDub can't download them. Use video files you own or are licensed to dub.`
    )
  }
  if (on(PLATFORM)) {
    throw new Error(`Links to ${host} pages aren't downloaded here. If it's your own upload, download it from the platform (e.g. YouTube Studio → Download), then use Import Video or Import Folder.`)
  }
  if (/\.(m3u8|mpd)$/i.test(u.pathname)) throw new Error('Streaming playlists (HLS/DASH) are not supported — use a link to a video file.')

  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const id = u.pathname.match(/\/d\/([\w-]{10,})/)?.[1] ?? u.searchParams.get('id')
    if (!id) throw new Error('Could not find the file id in that Google Drive link. Use the file\'s "Share → Copy link".')
    return { url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, kind: 'gdrive' }
  }
  if (host.endsWith('dropbox.com')) {
    u.searchParams.delete('dl')
    u.searchParams.set('dl', '1')
    return { url: u.toString(), kind: 'dropbox' }
  }
  return { url: u.toString(), kind: 'direct' }
}

function fileName(res: Response, kind: string): string {
  const cd = res.headers.get('content-disposition') ?? ''
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1]
  const plain = cd.match(/filename="?([^";]+)"?/i)?.[1]
  let name = star ? decodeURIComponent(star.replace(/"/g, '')) : plain ?? decodeURIComponent(new URL(res.url).pathname.split('/').pop() ?? '')
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 120) || `video-${kind}`
  if (!VIDEO_EXT.test(name)) name += '.mp4'
  return name
}

export async function download(p: DownloadPayload, ctx: JobCtx): Promise<{ path: string }> {
  const { url, kind } = resolveLink(p.url)
  ctx.progress(0, 'Connecting')
  const res = await fetch(url, { redirect: 'follow', signal: ctx.signal, headers: { 'user-agent': 'KhmerDubStudio' } })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`)
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  if (type.includes('text/html')) {
    throw new Error(
      kind === 'gdrive'
        ? 'Google Drive returned a web page: make sure the file is shared as "Anyone with the link" and is a video.'
        : 'That link opens a web page, not a video file. Use a direct download link to the file.'
    )
  }
  if (type && !/^(video\/|audio\/|application\/(octet-stream|x-matroska|mp4|binary|force-download))/.test(type)) {
    throw new Error(`That link is not a video file (${type}).`)
  }

  mkdirSync(p.outDir, { recursive: true })
  let name = fileName(res, kind)
  let path = join(p.outDir, name)
  for (let i = 2; existsSync(path); i++) path = join(p.outDir, name.replace(/(\.[^.]+)$/, ` (${i})$1`))

  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  let last = 0
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      got += chunk.length
      const now = Date.now()
      if (now - last > 300) {
        last = now
        const mb = (got / 1048576).toFixed(1)
        ctx.progress(total ? (got / total) * 100 : 0, total ? `Downloading ${mb} / ${(total / 1048576).toFixed(1)} MB` : `Downloading ${mb} MB`)
      }
      cb(null, chunk)
    }
  })
  try {
    await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(path))
  } catch (e) {
    await unlink(path).catch(() => {})
    throw e
  }
  if (got < 1024) {
    await unlink(path).catch(() => {})
    throw new Error('The download was empty — check that the link points to a video file you can access.')
  }
  ctx.progress(100, `Downloaded ${(got / 1048576).toFixed(1)} MB`)
  return { path }
}

export const isVideoName = (n: string) => VIDEO_EXT.test(n)
