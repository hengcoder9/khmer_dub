// Cloud drive share links from a distributor / partner: Google Drive folders, Dropbox folders, OneDrive
// (files and folders) and MEGA (files and folders, decrypted with megajs). Folders are listed so the user can
// pick episodes; every file then downloads as its own job, in episode order.

import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { File as MegaFile } from 'megajs'
import type { JobCtx } from '../queue'
import { sortByEpisode } from '../../shared/episodes'

export type CloudKind = 'gdrive-folder' | 'dropbox-folder' | 'onedrive' | 'mega'

const VIDEO_EXT = /\.(mp4|m4v|mkv|mov|webm|avi)$/i
const safe = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 120) || 'video.mp4'

export interface CloudEntry {
  index: number
  title: string
  url: string
  duration: null
  thumbnail: null
  size?: number
}

/** Which cloud folder / file link is this (null = not one of these). */
export function cloudLink(raw: string): { kind: CloudKind; url: string } | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (host === 'drive.google.com') {
    const id = u.pathname.match(/\/folders\/([\w-]{10,})/)?.[1]
    if (id) return { kind: 'gdrive-folder', url: id }
  }
  if (host.endsWith('dropbox.com') && /^\/(scl\/fo|sh)\//.test(u.pathname)) return { kind: 'dropbox-folder', url: u.toString() }
  if (host === '1drv.ms' || host === 'onedrive.live.com' || host.endsWith('.sharepoint.com')) return { kind: 'onedrive', url: u.toString() }
  if (host === 'mega.nz' || host === 'mega.co.nz') return { kind: 'mega', url: u.toString() }
  return null
}

/** OneDrive "shares" id for a sharing link: "u!" + base64url(link). */
export const oneDriveShareId = (link: string) => 'u!' + Buffer.from(link, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

/** Google Drive public folder page → its video files (id + name). */
export function parseDriveFolder(html: string): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = []
  const re = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g
  for (let m; (m = re.exec(html)); ) out.push({ id: m[1], name: decode(m[2]).trim() })
  return out
}

const asEntries = (files: Array<{ title: string; url: string; size?: number }>): CloudEntry[] =>
  sortByEpisode(files, (f) => f.title).map((f, i) => ({ index: i + 1, title: f.title, url: f.url, duration: null, thumbnail: null, size: f.size }))

type Listing = { type: 'file'; kind: CloudKind; title?: string } | { type: 'playlist'; title: string; uploader: null; site: string; thumbnail: null; count: number; truncated: false; entries: CloudEntry[] }

/** For the Import Link preview: a single file, or the (video) files of a shared folder. */
export async function listCloud(kind: CloudKind, url: string): Promise<Listing> {
  if (kind === 'dropbox-folder') return { type: 'file', kind, title: 'Dropbox folder (all videos in it)' }
  if (kind === 'gdrive-folder') {
    const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(url)}`, { headers: { 'user-agent': 'Mozilla/5.0' } })
    if (!res.ok) throw new Error(`Google Drive folder could not be opened (HTTP ${res.status}). Share it as "Anyone with the link".`)
    const html = await res.text()
    const files = parseDriveFolder(html).filter((f) => VIDEO_EXT.test(f.name))
    if (!files.length) throw new Error('No video files in that Google Drive folder (or it is not shared as "Anyone with the link").')
    const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Google Drive folder')
    const entries = asEntries(files.map((f) => ({ title: f.name, url: `https://drive.google.com/file/d/${f.id}/view` })))
    return { type: 'playlist', title, uploader: null, site: 'Google Drive', thumbnail: null, count: entries.length, truncated: false, entries }
  }
  if (kind === 'onedrive') {
    const item = await oneDriveItem(url)
    if (!item.folder) return { type: 'file', kind, title: item.name }
    const files = (item.children ?? []).filter((c) => c.file && VIDEO_EXT.test(c.name) && c['@content.downloadUrl'])
    if (!files.length) throw new Error('No video files in that OneDrive folder.')
    // the download URLs are pre-signed for about an hour — plenty, downloads start right away
    const entries = asEntries(files.map((c) => ({ title: c.name, url: c['@content.downloadUrl']!, size: c.size })))
    return { type: 'playlist', title: item.name, uploader: null, site: 'OneDrive', thumbnail: null, count: entries.length, truncated: false, entries }
  }
  // MEGA
  const node = await megaNode(url)
  if (!node.directory) return { type: 'file', kind, title: node.name ?? undefined }
  const base = url.replace(/\/file\/[\w-]+$/, '')
  const files: Array<{ title: string; url: string; size?: number }> = []
  const walk = (n: MegaFile) => {
    for (const c of n.children ?? []) {
      if (c.directory) walk(c)
      else if (c.name && VIDEO_EXT.test(c.name)) files.push({ title: c.name, url: `${base}/file/${c.nodeId}`, size: c.size })
    }
  }
  walk(node)
  if (!files.length) throw new Error('No video files in that MEGA folder.')
  const entries = asEntries(files)
  return { type: 'playlist', title: node.name ?? 'MEGA folder', uploader: null, site: 'MEGA', thumbnail: null, count: entries.length, truncated: false, entries }
}

interface OneDriveItem {
  name: string
  size?: number
  folder?: unknown
  file?: unknown
  '@content.downloadUrl'?: string
  children?: OneDriveItem[]
}

async function oneDriveItem(link: string): Promise<OneDriveItem> {
  const res = await fetch(`https://api.onedrive.com/v1.0/shares/${oneDriveShareId(link)}/driveItem?$expand=children`, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? 'OneDrive did not allow access: share it as "Anyone with the link can view". (Work / school OneDrive links that need sign-in can\'t be downloaded.)'
        : `OneDrive link could not be opened (HTTP ${res.status}).`
    )
  }
  return (await res.json()) as OneDriveItem
}

async function megaNode(url: string): Promise<MegaFile> {
  try {
    return (await MegaFile.fromURL(url).loadAttributes()) as MegaFile
  } catch (e) {
    throw new Error(`MEGA link could not be opened: ${(e as Error).message}. Use the full link including the part after "#".`)
  }
}

function meter(ctx: JobCtx, total: number) {
  let got = 0
  let last = 0
  const t = new Transform({
    transform(chunk: Buffer, _e, cb) {
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
  return { t, got: () => got }
}

const uniquePath = (dir: string, name: string) => {
  let p = join(dir, safe(name))
  for (let i = 2; existsSync(p); i++) p = join(dir, safe(name).replace(/(\.[^.]+)?$/, ` (${i})$1`))
  return p
}

/** One MEGA file (decrypted while it downloads). */
export async function downloadMega(url: string, outDir: string, ctx: JobCtx): Promise<{ path: string; title?: string }> {
  ctx.progress(0, 'Opening MEGA link')
  const node = await megaNode(url)
  if (node.directory) throw new Error('That MEGA link is a folder — pick the videos in Import Link.')
  mkdirSync(outDir, { recursive: true })
  const path = uniquePath(outDir, node.name && VIDEO_EXT.test(node.name) ? node.name : `${node.name ?? 'mega-video'}.mp4`)
  const m = meter(ctx, node.size ?? 0)
  try {
    await pipeline(node.download({}) as unknown as NodeJS.ReadableStream, m.t, createWriteStream(path), { signal: ctx.signal })
  } catch (e) {
    rmSync(path, { force: true })
    throw new Error(/bandwidth|EOVERQUOTA|509/i.test((e as Error).message) ? 'MEGA download limit reached for now (MEGA limits free transfers). Try again later.' : `MEGA download failed: ${(e as Error).message}`)
  }
  ctx.progress(100, `Downloaded ${(m.got() / 1048576).toFixed(1)} MB`)
  return { path, title: node.name ?? undefined }
}

/** OneDrive single-file link → its pre-signed download URL. */
export async function oneDriveFileUrl(link: string): Promise<string> {
  const item = await oneDriveItem(link)
  if (item.folder) throw new Error('That OneDrive link is a folder — pick the videos in Import Link.')
  if (!item['@content.downloadUrl']) throw new Error('OneDrive did not give a download link for that file.')
  return item['@content.downloadUrl']
}

/** Windows' own tar (bsdtar, reads zip) — not a GNU tar from Git that may come first on the PATH. */
export const systemTar = () => (process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar')

/** Dropbox folder: download it as a zip, unpack the videos (Windows' built-in tar reads zip), in episode order. */
export async function downloadDropboxFolder(link: string, outDir: string, ctx: JobCtx): Promise<{ path: string; paths: string[]; title?: string }> {
  const u = new URL(link)
  u.searchParams.set('dl', '1')
  ctx.progress(0, 'Connecting to Dropbox')
  const res = await fetch(u, { redirect: 'follow', signal: ctx.signal })
  if (!res.ok || !res.body) throw new Error(`Dropbox folder download failed: HTTP ${res.status}`)
  const work = join(tmpdir(), `kd-dbx-${Date.now()}`)
  mkdirSync(work, { recursive: true })
  const zip = join(work, 'folder.zip')
  try {
    const m = meter(ctx, Number(res.headers.get('content-length')) || 0)
    const { Readable } = await import('node:stream')
    await pipeline(Readable.fromWeb(res.body as never), m.t, createWriteStream(zip))
    ctx.progress(97, 'Unpacking')
    await new Promise<void>((resolve, reject) => {
      const p = spawn(systemTar(), ['-xf', zip, '-C', work], { windowsHide: true })
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('The Dropbox folder zip could not be unpacked'))))
    })
    const found: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (VIDEO_EXT.test(e.name)) found.push(p)
      }
    }
    walk(work)
    if (!found.length) throw new Error('No video files in that Dropbox folder.')
    mkdirSync(outDir, { recursive: true })
    const paths = sortByEpisode(found, (p) => p.split(/[\\/]/).pop()!).map((p) => {
      const dest = uniquePath(outDir, p.split(/[\\/]/).pop()!)
      renameSync(p, dest)
      return dest
    })
    const mb = paths.reduce((a, p) => a + statSync(p).size, 0) / 1048576
    ctx.progress(100, `${paths.length} videos (${mb.toFixed(0)} MB)`)
    return { path: paths[0], paths, title: `${paths.length} videos` }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
