import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
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
