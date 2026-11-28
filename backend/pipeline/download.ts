// "Import Link": download a video the user owns or is licensed to use.
// Direct files, Google Drive and Dropbox are fetched as-is; other web pages go through yt-dlp (same flow as VidGrab).
// Streaming / VIP platforms are refused on purpose: their episodes are licensed to them and copy-protected.

import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { JobCtx } from '../queue'
import { downloadArgs, explainError, parseLine, runYtdlp, type Quality } from './ytdlp'
import { cloudLink, downloadDropboxFolder, downloadMega, oneDriveFileUrl } from './cloud'

export interface DownloadPayload {
  url: string
  outDir: string
  /** yt-dlp only (web page links) */
  quality?: Quality
}

/** Paywalled / DRM streaming services (drama apps and video platforms). */
const BLOCKED = [
  'iq.com', 'iqiyi.com', 'wetv.vip', 'v.qq.com', 'qq.com', 'hongguoduanju.com', 'dramabox', 'goodshort',
  'youku.com', 'mgtv.com', 'bilibili.com', 'netflix.com', 'viu.com', 'disneyplus.com', 'primevideo.com', 'reelshort', 'shortmax', 'flextv'
]

/** Sites that show dramas without the rights holders' permission (and their short links). */
const UNLICENSED = ['kisskh']

const VIDEO_EXT = /\.(mp4|m4v|mkv|mov|webm|avi)$/i

export type LinkKind = 'direct' | 'gdrive' | 'dropbox' | 'page'

export function resolveLink(raw: string): { url: string; kind: LinkKind } {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error('That is not a valid link. Paste a full https:// link to a video file.')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) links are supported.')
  const host = u.hostname.toLowerCase()
  const on = (list: string[]) => list.some((d) => host === d || host.endsWith('.' + d) || (!d.includes('.') && host.includes(d)))
  if (on(UNLICENSED)) {
    throw new Error(
      `${host} shows dramas without the permission of the studios that own them, so KhmerDub doesn't download from it. Use episodes you own or are licensed to dub — e.g. files or a Google Drive / Dropbox / OneDrive / MEGA link from your distributor.`
    )
  }
  if (on(BLOCKED)) {
    throw new Error(
      `${host} is a streaming / VIP service: its episodes are licensed to that platform and copy-protected, so KhmerDub can't download them. Use video files you own or are licensed to dub.`
    )
  }

  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const id = u.pathname.match(/\/d\/([\w-]{10,})/)?.[1] ?? u.searchParams.get('id')
    if (!id) throw new Error('Could not find the file id in that Google Drive link. Use the file\'s "Share → Copy link".')
    return { url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, kind: 'gdrive' }
  }
  // OneDrive's pre-signed download URLs (from a shared folder listing) are plain files
  if (host.endsWith('files.1drv.com') || (host.endsWith('.sharepoint.com') && /download\.aspx/i.test(u.pathname))) return { url: u.toString(), kind: 'direct' }
  if (host.endsWith('dropbox.com')) {
    u.searchParams.delete('dl')
    u.searchParams.set('dl', '1')
    return { url: u.toString(), kind: 'dropbox' }
  }
  // a link to a video file → plain download; anything else (a video page, HLS playlist…) → yt-dlp
  return { url: u.toString(), kind: VIDEO_EXT.test(u.pathname) ? 'direct' : 'page' }
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

export async function download(p: DownloadPayload, ctx: JobCtx): Promise<{ path: string; paths?: string[]; title?: string }> {
  // checks the blocked list first
  let { url, kind } = resolveLink(p.url)
  const cloud = cloudLink(p.url)
  if (cloud?.kind === 'mega') return downloadMega(cloud.url, p.outDir, ctx)
  if (cloud?.kind === 'dropbox-folder') return downloadDropboxFolder(cloud.url, p.outDir, ctx)
  if (cloud?.kind === 'gdrive-folder') throw new Error('That is a Google Drive folder — paste it in Import Link and pick the videos.')
  if (cloud?.kind === 'onedrive') {
    ctx.progress(0, 'Opening OneDrive link')
    url = await oneDriveFileUrl(cloud.url)
    kind = 'direct'
  }
  if (kind === 'page') return downloadPage(url, p.outDir, p.quality ?? 'best', ctx)
  ctx.progress(0, 'Connecting')
  const res = await fetch(url, { redirect: 'follow', signal: ctx.signal, headers: { 'user-agent': 'KhmerDubStudio' } })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`)
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  if (type.includes('text/html')) {
    // a "file" link that is really a page (e.g. a wiki File:… page): let yt-dlp find the video in it
    if (kind === 'direct') {
      await res.body.cancel().catch(() => {})
      return downloadPage(url, p.outDir, p.quality ?? 'best', ctx)
    }
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

/** Web page link → yt-dlp (best/1080/720/480, mp4), with live progress. */
async function downloadPage(url: string, outDir: string, quality: Quality, ctx: JobCtx): Promise<{ path: string; title?: string }> {
  mkdirSync(outDir, { recursive: true })
  ctx.progress(0, 'Starting yt-dlp')
  let file: string | null = null
  let title: string | undefined
  let part = 0
  let parts = 1
  let best = 0
  const fmt = (b: number | null) => (b == null ? '?' : `${(b / 1048576).toFixed(1)} MB`)
  const r = await runYtdlp(downloadArgs(url, quality, outDir), {
    cwd: outDir,
    signal: ctx.signal,
    onLine: (line) => {
      const ev = parseLine(line)
      if (!ev) return
      switch (ev.type) {
        case 'meta':
          if (ev.title) title = ev.title
          break
        case 'parts':
          parts = ev.count
          break
        case 'part':
          part = Math.min(part + 1, parts)
          break
        case 'progress': {
          let frac = ev.total ? (ev.downloaded ?? 0) / ev.total : null
          if (frac == null && ev.fragCount) frac = (ev.fragIndex ?? 0) / ev.fragCount
          if (ev.status === 'finished') frac = 1
          if (frac != null) {
            const k = Math.max(part, 1)
            best = Math.max(best, Math.min(99, (((k - 1) + Math.min(frac, 1)) / Math.max(parts, k)) * 100))
          }
          const speed = ev.speed ? ` · ${(ev.speed / 1048576).toFixed(1)} MB/s` : ''
          const eta = ev.eta != null ? ` · ${Math.round(ev.eta)}s left` : ''
          const which = parts > 1 ? ` (${part === parts ? 'audio' : 'video'})` : ''
          ctx.progress(best, `Downloading${which} ${fmt(ev.downloaded)} / ${fmt(ev.total)}${speed}${eta}`)
          break
        }
        case 'postprocess':
          if (ev.status === 'started') ctx.progress(best, /Merger/.test(ev.name) ? 'Merging video + audio' : 'Converting to MP4')
          break
        case 'file':
          file = ev.path
          break
      }
    }
  })
  if (!file || !existsSync(file)) {
    const msg = r.errors[r.errors.length - 1] ?? r.tail.filter(Boolean).slice(-1)[0] ?? `yt-dlp exited with code ${r.code}`
    throw new Error(explainError(msg))
  }
  ctx.progress(100, `Downloaded ${title ?? 'video'}`)
  return { path: file, title }
}

export const isVideoName = (n: string) => VIDEO_EXT.test(n)
