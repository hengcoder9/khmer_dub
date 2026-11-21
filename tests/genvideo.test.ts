import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

// fake Google: each call to https.request takes the next scripted reply
type Reply = { status: number; body: unknown }
const replies: Reply[] = []
const calls: Array<{ method: string; url: string; key: string; body?: any }> = []
vi.mock('node:https', () => ({
  request: (url: string, opts: { method: string; headers: Record<string, string> }, cb: (res: EventEmitter & { statusCode: number }) => void) => {
    const req = new EventEmitter() as EventEmitter & { write: (d: Buffer) => void; end: () => void }
    let sent = ''
    req.write = (d) => (sent += d.toString())
    req.end = () => {
      calls.push({ method: opts.method, url, key: opts.headers['x-goog-api-key'], body: sent ? JSON.parse(sent) : undefined })
      const r = replies.shift() ?? { status: 500, body: { error: { message: 'no scripted reply' } } }
      const res = Object.assign(new EventEmitter(), { statusCode: r.status })
      cb(res)
      res.emit('data', Buffer.from(JSON.stringify(r.body)))
      res.emit('end')
    }
    return req
  }
}))

const { genVideo, omniBody, findVideo, omniError } = await import('../backend/pipeline/genvideo')
const { keyPool } = await import('../backend/lib/keys')

const MP4 = Buffer.concat([Buffer.from('....ftypisom'), Buffer.alloc(4000, 7)])
const done = (id = 'v1_abc') => ({
  id,
  status: 'completed',
  object: 'interaction',
  steps: [
    { type: 'user_input', content: [{ type: 'text', text: 'x' }] },
    { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: MP4.toString('base64') }] }
  ]
})
const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

describe('AI Video from prompt (Gemini Omni)', () => {
  let dir: string
  beforeEach(() => {
    replies.length = 0
    calls.length = 0
    keyPool.set([
      { id: 'g1', provider: 'gemini', key: 'KEY-1' },
      { id: 'g2', provider: 'gemini', key: 'KEY-2' }
    ])
    dir = mkdtempSync(join(tmpdir(), 'kd-gv-'))
    return () => rmSync(dir, { recursive: true, force: true })
  })

  it('builds the Omni request (duration as "Ns", clamped 3–15, image + text parts)', () => {
    expect(omniBody({ prompt: 'p', aspect: '9:16', resolution: '720p', seconds: 20 })).toEqual({
      model: 'gemini-omni-1.2-flash',
      input: 'p',
      response_format: { type: 'video', aspect_ratio: '9:16', resolution: '720p', duration: '15s' }
    })
    const b = omniBody({ prompt: 'p', aspect: '16:9', resolution: '360p', seconds: 1, image: { data: 'AAA', mime: 'image/png' } })
    expect(b.input).toEqual([{ type: 'image', data: 'AAA', mime_type: 'image/png' }, { type: 'text', text: 'p' }])
    expect(b.response_format.duration).toBe('3s')
  })

  it('finds the video in steps and explains errors', () => {
    expect(findVideo(done())?.mime_type).toBe('video/mp4')
    expect(findVideo({ steps: [{ type: 'model_output', content: [{ type: 'video', uri: 'files/x' }] }] })?.uri).toBe('files/x')
    expect(findVideo({ steps: [] })).toBeNull()
    expect(omniError(429, { error: { message: 'Resource exhausted' } })).toMatch(/paid tier/)
    expect(omniError(0, { status: 'failed', errors: [{ message: 'blocked by safety policy' }] })).toMatch(/safety filters/)
  })

  it('saves the inline video from a finished interaction', async () => {
    replies.push({ status: 200, body: done() })
    const r = await genVideo({ prompt: 'tuk-tuk at night', aspect: '9:16', resolution: '720p', seconds: 8, outDir: dir, name: 'AI test' }, ctx)
    expect(basename(r.path)).toBe('AI test.mp4')
    expect(readFileSync(r.path).equals(MP4)).toBe(true)
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/interactions' })
    expect(calls[0].body.response_format).toEqual({ type: 'video', aspect_ratio: '9:16', resolution: '720p', duration: '8s' })
  })

  it('polls when the interaction is still in progress', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    replies.push({ status: 200, body: { id: 'v1_slow', status: 'in_progress', steps: [] } }, { status: 200, body: done('v1_slow') })
    const p = genVideo({ prompt: 'x', aspect: '16:9', resolution: '360p', seconds: 4, outDir: dir, name: 'slow' }, ctx)
    await vi.advanceTimersByTimeAsync(5100)
    const r = await p
    vi.useRealTimers()
    expect(calls.map((c) => c.method + ' ' + c.url.split('/v1beta/')[1])).toEqual(['POST interactions', 'GET interactions/v1_slow'])
    expect(readFileSync(r.path).length).toBe(MP4.length)
  })

  it('moves to the next Gemini key when one is out of quota', async () => {
    replies.push({ status: 429, body: { error: { message: 'quota' } } }, { status: 200, body: done() })
    await genVideo({ prompt: 'x', aspect: '9:16', resolution: '720p', seconds: 3, outDir: dir, name: 'k' }, ctx)
    expect(calls.map((c) => c.key).sort()).toEqual(['KEY-1', 'KEY-2'])
  })

  it('reports a blocked prompt clearly', async () => {
    replies.push({ status: 200, body: { id: 'v1_b', status: 'failed', errors: [{ message: 'Prompt blocked: usage policy' }] } })
    await expect(genVideo({ prompt: 'x', aspect: '9:16', resolution: '720p', seconds: 3, outDir: dir, name: 'b' }, ctx)).rejects.toThrow(/safety filters/)
  })
})
