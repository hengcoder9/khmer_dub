import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { isVideoName, resolveLink } from '../pipeline/download'
import { explainError, infoArgs, runYtdlp, summarizeInfo } from '../pipeline/ytdlp'
import { probeMedia } from '../lib/ffmpeg'
import { allowFile, isAllowed } from '../lib/allow'
import { getPeaks, getThumb } from '../lib/peaks'

// Chromium sniffs the real container; these types just keep it from refusing the response.
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4',
  '.mkv': 'video/webm',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png'
}

async function checkFile(p: string | undefined): Promise<{ abs: string; size: number } | { code: number; error: string }> {
  if (!p) return { code: 400, error: 'path required' }
  const abs = resolve(p)
  if (!isAllowed(abs)) return { code: 403, error: 'file was not opened in the app' }
  try {
    const s = await stat(abs)
    if (!s.isFile()) return { code: 400, error: 'not a file' }
    return { abs, size: s.size }
  } catch {
    return { code: 404, error: 'file not found' }
  }
}

export async function mediaRoutes(app: FastifyInstance) {
  /**
   * Import Link preview: direct / Drive / Dropbox links are plain files; anything else is asked of yt-dlp
   * (title, thumbnail, duration, qualities — or the videos of a playlist).
   */
  app.post<{ Body: { url?: string; playlist?: boolean } }>('/link/info', async (req, reply) => {
    let link
    try {
      link = resolveLink(req.body?.url ?? '')
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
    if (link.kind === 'gdrive' || link.kind === 'dropbox') return { type: 'file', kind: link.kind }
    try {
      const r = await runYtdlp(infoArgs(link.url, !!req.body?.playlist), { keepStdout: true, timeoutMs: 90_000 })
      if (link.kind === 'direct' && (r.code !== 0 || !r.stdout.trim())) return { type: 'file', kind: 'direct' }
      if (r.code !== 0 || !r.stdout.trim()) {
        return reply.code(422).send({ error: explainError(r.errors[r.errors.length - 1] ?? `yt-dlp exited with code ${r.code}`) })
      }
      return summarizeInfo(JSON.parse(r.stdout))
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message })
    }
  })

  /** Video files in a folder the user picked, in natural order (EP2 before EP10). */
  app.post<{ Body: { dir?: string } }>('/media/scan-dir', async (req, reply) => {
    const dir = req.body?.dir
    if (!dir) return reply.code(400).send({ error: 'dir required' })
    const abs = resolve(dir)
    const names = (await readdir(abs, { withFileTypes: true })).filter((d) => d.isFile() && isVideoName(d.name)).map((d) => d.name)
    names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    return { files: names.map((n) => join(abs, n)) }
  })

  /** Probe a file the user picked and allow it to be streamed. */
  app.post<{ Body: { path?: string } }>('/media/probe', async (req, reply) => {
    const p = req.body?.path
    if (!p) return reply.code(400).send({ error: 'path required' })
    const abs = resolve(p)
    try {
      if (!(await stat(abs)).isFile()) return reply.code(400).send({ error: 'not a file' })
    } catch {
      return reply.code(404).send({ error: 'file not found' })
    }
    const info = await probeMedia(abs)
    allowFile(abs)
    return info
  })

  /** Allow a user-picked file without probing (audio imports etc.). */
  app.post<{ Body: { path?: string } }>('/media/allow', async (req, reply) => {
    if (!req.body?.path) return reply.code(400).send({ error: 'path required' })
    allowFile(req.body.path)
    return { ok: true }
  })

  app.get<{ Querystring: { path?: string } }>('/media/peaks', async (req, reply) => {
    const f = await checkFile(req.query.path)
    if ('code' in f) return reply.code(f.code).send({ error: f.error })
    return getPeaks(f.abs)
  })

  app.get<{ Querystring: { path?: string; t?: string; w?: string } }>('/media/thumb', async (req, reply) => {
    const f = await checkFile(req.query.path)
    if ('code' in f) return reply.code(f.code).send({ error: f.error })
    const buf = await getThumb(f.abs, Number(req.query.t ?? 0), Math.min(480, Number(req.query.w ?? 160)))
    reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'max-age=3600')
    return reply.send(buf)
  })

  app.get<{ Querystring: { path?: string } }>('/media/file', async (req, reply) => {
    const f = await checkFile(req.query.path)
    if ('code' in f) return reply.code(f.code).send({ error: f.error })
    const { abs, size } = f
    reply.header('Accept-Ranges', 'bytes')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Content-Type', MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream')

    const range = req.headers.range
    if (!range) {
      reply.header('Content-Length', size)
      return reply.send(createReadStream(abs))
    }
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    let start: number
    let end: number
    if (!m || (!m[1] && !m[2])) {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send()
    } else if (!m[1]) {
      start = Math.max(0, size - Number(m[2]))
      end = size - 1
    } else {
      start = Number(m[1])
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    }
    if (start >= size || start > end) {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send()
    }
    reply.code(206)
    reply.header('Content-Range', `bytes ${start}-${end}/${size}`)
    reply.header('Content-Length', end - start + 1)
    return reply.send(createReadStream(abs, { start, end }))
  })
}
