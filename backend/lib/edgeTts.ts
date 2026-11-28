/**
 * Native Node client for Microsoft Edge's online "Read Aloud" TTS service.
 *
 * Protocol and Sec-MS-GEC v2 token are ported from the Python `edge-tts` package
 * (rany2/edge-tts 7.3.1, LGPL-3.0). If Microsoft changes the handshake again, compare
 * CHROMIUM_FULL_VERSION and the DRM constants below with the latest edge-tts release.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import WebSocket from 'ws'
import { CanceledError } from '../queue'

const BASE_URL = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud'
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`
const VOICE_LIST = `https://${BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`
const CHROMIUM_FULL_VERSION = '143.0.3650.75'
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0]
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`
const BASE_HEADERS = {
  'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'en-US,en;q=0.9'
}
const WSS_HEADERS = {
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  ...BASE_HEADERS
}
const VOICE_HEADERS = {
  Authority: 'speech.platform.bing.com',
  'Sec-CH-UA': `" Not;A Brand";v="99", "Microsoft Edge";v="${CHROMIUM_MAJOR}", "Chromium";v="${CHROMIUM_MAJOR}"`,
  'Sec-CH-UA-Mobile': '?0',
  Accept: '*/*',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  ...BASE_HEADERS
}

// ───────────────────────── Sec-MS-GEC v2 token ─────────────────────────

const WIN_EPOCH = 11644473600n
const SHA_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
const SHA_STATE = [0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2]
const SHA_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e,
  0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564
]
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]
const SHA_ADJ = 0xc9dc06a7
const K_BLOCK = [...K.slice(0, 14), SHA_ADJ, ...K.slice(15)]
const SIGMA0_ADJ = 0x059c0b80
const SIGMA1_ADJ = 0x000b92c0
const CS64_COEF: Array<[number, number]> = [
  [0xe82e91b1, 0xb32700d0], [0x44de24c6, 0x88dff51d], [0x3beb65bc, 0x29514038], [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5], [0x314ef5d5, 0x26e55f3c], [0xe92491b1, 0x607801c6], [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da], [0xda79fa60, 0x207cc464], [0xbed20560, 0x3c3c74f3], [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1], [0xcb49e3c6, 0xc5626167]
]
const CS64_FACTOR = 0x82893933
const CS64_ADJ0 = 0xf2f90b1a
const CS64_ADJ1 = 0x0b1a0000

const u32 = (x: number) => x >>> 0
const mul = (a: number, b: number) => Math.imul(a, b) >>> 0
const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0
const rol16 = (x: number) => ((x << 16) | (x >>> 16)) >>> 0
const sigma0 = (x: number) => (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0
const sigma1 = (x: number) => (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0

function expand(w: number[], from = 16): void {
  for (let i = from; i < 64; i++) w.push(u32(sigma1(w[i - 2]) + w[i - 7] + sigma0(w[i - 15]) + w[i - 16]))
}

function rounds(state: number[], w: number[], first = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state
  const k = first === 14 ? K_BLOCK : K
  for (let i = first; i < 64; i++) {
    const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
    const t1 = u32(h + s1 + (g ^ (e & (f ^ g))) + k[i] + w[i])
    const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
    const t2 = u32(s0 + ((a & b) | (c & (a | b))))
    h = g
    g = f
    f = e
    e = u32(d + t1)
    d = c
    c = b
    b = a
    a = u32(t1 + t2)
  }
  return [a, b, c, d, e, f, g, h]
}

function shaInit(data: Buffer): number[] {
  const w: number[] = new Array(14).fill(0)
  w.push(data.readUIntBE(0, 3), data.readUInt32BE(3))
  for (let i = 16; i < 30; i++) {
    let v = SHA_SCHEDULE[i - 16]
    if (i - 2 >= 14) v += i === 16 ? (sigma1(w[i - 2]) ^ SIGMA1_ADJ) >>> 0 : sigma1(w[i - 2])
    if (i - 7 >= 14) v += w[i - 7]
    if (i - 15 >= 14) v += i === 29 ? (sigma0(w[i - 15]) ^ SIGMA0_ADJ) >>> 0 : sigma0(w[i - 15])
    w.push(u32(v))
  }
  w.push(u32(sigma1(w[28]) + w[23] + sigma0(w[15]) + w[14] + SHA_ADJ - K[14]))
  expand(w, 31)
  const working = rounds(SHA_STATE, w, 14)
  return SHA_INITIAL.map((x, i) => u32(x + working[i]))
}

function shaDigest(data: Buffer): Buffer {
  const length = 57 + data.length
  const zeros = (((55 - length) % 64) + 64) % 64
  const lenBuf = Buffer.alloc(8)
  lenBuf.writeBigUInt64BE(BigInt(length) * 8n)
  const padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(zeros), lenBuf])
  let state = shaInit(data.subarray(0, 7))
  for (let off = 0; off < padded.length; off += 64) {
    const w: number[] = []
    for (let i = 0; i < 16; i++) w.push(padded.readUInt32BE(off + i * 4))
    expand(w)
    const working = rounds(state, w)
    state = state.map((x, i) => u32(x + working[i]))
  }
  const out = Buffer.alloc(32)
  state.forEach((x, i) => out.writeUInt32BE(x, i * 4))
  return out
}

function cs64(data: Buffer, digest: Buffer): [number, number] {
  const keyA = (digest.readUInt32LE(0) | 1) >>> 0
  const keyB = (digest.readUInt32LE(4) | 1) >>> 0
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)]
  const terms = CS64_COEF.map(([c], i) => mul(c, factors[i % 2]))
  const offsets = CS64_COEF.map(([, o]) => o)
  const src = Buffer.concat([Buffer.from([0]), data])
  const padded = Buffer.concat([src, Buffer.alloc((4 - (src.length % 4)) % 4)])
  const words: number[] = []
  for (let i = 0; i < padded.length; i += 4) words.push(padded.readUInt32LE(i))
  if (words.length % 2) words.push(0)
  words.forEach((word, i) => {
    let term = mul(word, i % 2 === 0 ? keyA : keyB)
    let offset = mul(rol16(word), i % 2 === 0 ? 0xef0569fb : 0xc31713db)
    if (i === 0) {
      term = u32(term + mul(CS64_ADJ0, factors[0]))
      offset = u32(offset + CS64_ADJ1)
    }
    terms.push(term)
    offsets.push(offset)
  })
  let swapAcc = 0
  let swapLast = 0
  let state = 0
  let acc = 0
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i]
    const y = terms[i + 1]
    let t = rol16(u32(offsets[i] + x))
    let q = mul(t, 0x76f50f34)
    swapAcc = u32(swapAcc + u32(mul(rol16(q), 0xc3efea97) + q))
    t = rol16(u32(offsets[i + 1] + y))
    q = mul(t, 0x1881ce3c)
    swapLast = u32(mul(rol16(q), 0x35bd1ec9) + q)
    swapAcc = u32(swapAcc + swapLast)

    state = u32(mul(state, keyA) + x)
    state = mul(rol16(state), 0xcf98b111)
    state = mul(rol16(state), 0x87085b9f)
    state = mul(rol16(state), 0x12ceb96d)
    state = mul(rol16(state), 0x257e1d83)
    acc = u32(acc + state)
    t = u32(mul(state, keyB) + y)
    t = mul(rol16(t), 0xa27416f5)
    t = mul(rol16(t), 0xd38396ff)
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69)
    acc = u32(acc + state)
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0]
}

let clockSkewSec = 0

/** Sec-MS-GEC v2 token: "<16 hex cs64>-<64 hex sha256>". */
export function secMsGec(unixSeconds = Date.now() / 1000 + clockSkewSec): string {
  let secs = BigInt(Math.floor(unixSeconds)) + WIN_EPOCH
  secs -= secs % 300n
  const data = Buffer.from(`${secs * 10_000_000n}${TRUSTED_CLIENT_TOKEN}`, 'ascii')
  const digest = shaDigest(data)
  const [c0, c1] = cs64(data, digest)
  const c = Buffer.alloc(8)
  c.writeUInt32LE(c0, 0)
  c.writeUInt32LE(c1, 4)
  return `${c.toString('hex').toUpperCase()}-${digest.toString('hex').toUpperCase()}`
}

/** Correct for a wrong system clock using the server's Date header (after a 403). */
function adjustSkew(dateHeader: string | undefined): boolean {
  const server = dateHeader ? Date.parse(dateHeader) : NaN
  if (Number.isNaN(server)) return false
  clockSkewSec += server / 1000 - (Date.now() / 1000 + clockSkewSec)
  return true
}

const muidHeaders = <T extends object>(h: T) => ({ ...h, Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};` })

// ───────────────────────── voices ─────────────────────────

export interface EdgeVoiceInfo {
  ShortName: string
  Gender: string
  Locale: string
  FriendlyName?: string
}

export async function listEdgeVoices(timeoutMs = 30_000): Promise<EdgeVoiceInfo[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = `${VOICE_LIST}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`
    const r = await fetch(url, { headers: muidHeaders(VOICE_HEADERS), signal: AbortSignal.timeout(timeoutMs) })
    if (r.status === 403 && attempt === 0 && adjustSkew(r.headers.get('date') ?? undefined)) continue
    if (!r.ok) throw new Error(`Edge voice list: HTTP ${r.status}`)
    return (await r.json()) as EdgeVoiceInfo[]
  }
  throw new Error('Edge voice list: HTTP 403')
}

// ───────────────────────── synthesis ─────────────────────────

export interface EdgeSynthOptions {
  voice: string
  /** "+0%" style */
  rate?: string
  /** "+0Hz" style */
  pitch?: string
  /** "+0%" style */
  volume?: string
  signal?: AbortSignal
  /** no data for this long → fail (ms) */
  timeoutMs?: number
  /** no audio after this long → send the same line again alongside (ms; 0 = never) */
  hedgeMs?: number
}

interface ChunkOptions extends EdgeSynthOptions {
  /** first audio frame arrived (the request is being served) */
  onAudio?: () => void
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// eslint-disable-next-line no-control-regex
const cleanText = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
const jsDate = () => new Date().toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (.*) GMT$/, '$1 $3 $2 $4 $5 GMT+0000 (Coordinated Universal Time)')

/** Split escaped text into ≤maxBytes UTF-8 chunks at newline/space, never inside a character or XML entity. */
export function splitText(text: string, maxBytes = 4096): string[] {
  const out: string[] = []
  let buf = Buffer.from(text, 'utf8')
  while (buf.length > maxBytes) {
    let at = buf.lastIndexOf(0x0a, maxBytes - 1)
    if (at < 0) at = buf.lastIndexOf(0x20, maxBytes - 1)
    if (at < 0) {
      at = maxBytes
      while (at > 0 && (buf[at] & 0xc0) === 0x80) at-- // back off UTF-8 continuation bytes
    }
    const amp = at > 0 ? buf.lastIndexOf(0x26, at - 1) : -1
    if (amp >= 0) {
      const semi = buf.indexOf(0x3b, amp)
      if (semi < 0 || semi >= at) at = amp // don't cut "&amp;"
    }
    const chunk = buf.subarray(0, at).toString('utf8').trim()
    if (chunk) out.push(chunk)
    buf = buf.subarray(at > 0 ? at : 1)
  }
  const rest = buf.toString('utf8').trim()
  if (rest) out.push(rest)
  return out
}

function synthChunk(ssmlText: string, o: ChunkOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const url = `${WSS_URL}&ConnectionId=${randomUUID().replace(/-/g, '')}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`
    const ws = new WebSocket(url, { headers: muidHeaders(WSS_HEADERS), perMessageDeflate: true })
    const parts: Buffer[] = []
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', onAbort)
      ws.removeAllListeners()
      ws.on('error', () => {})
      try {
        ws.terminate()
      } catch {
        /* already closed */
      }
      if (err) reject(err)
      else if (!parts.length) reject(new Error('No audio received'))
      else resolve(Buffer.concat(parts))
    }
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(new Error('Timed out waiting for Edge-TTS')), o.timeoutMs ?? 30_000)
    }
    const onAbort = () => finish(new CanceledError())
    if (o.signal?.aborted) return onAbort()
    o.signal?.addEventListener('abort', onAbort)
    arm()

    ws.on('unexpected-response', (_req, res) => {
      const err = new Error(`Edge-TTS handshake failed: HTTP ${res.statusCode}`) as Error & { status?: number; date?: string }
      err.status = res.statusCode
      err.date = res.headers.date
      finish(err)
    })
    ws.on('error', (e) => finish(e))
    ws.on('close', (code) =>
      finish(new Error(code === 1007 ? `Edge-TTS rejected the request (unknown voice "${o.voice}" or invalid rate/pitch)` : `Edge-TTS connection closed (${code})`))
    )
    ws.on('open', () => {
      ws.send(
        `X-Timestamp:${jsDate()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
          '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
      )
      const ssml =
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
        `<voice name='${o.voice}'><prosody pitch='${o.pitch ?? '+0Hz'}' rate='${o.rate ?? '+0%'}' volume='${o.volume ?? '+0%'}'>` +
        `${ssmlText}</prosody></voice></speak>`
      ws.send(`X-RequestId:${randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${jsDate()}Z\r\nPath:ssml\r\n\r\n${ssml}`)
    })
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      arm()
      if (!isBinary) {
        const text = data.toString('utf8')
        const path = /^Path:(.+)$/m.exec(text.slice(0, text.indexOf('\r\n\r\n')))?.[1]?.trim()
        if (path === 'turn.end') finish()
        return
      }
      if (data.length < 2) return finish(new Error('Malformed audio frame'))
      const headerLen = data.readUInt16BE(0)
      const headers = data.subarray(2, 2 + headerLen).toString('utf8')
      if (!/^Path:audio\r?$/m.test(headers)) return
      const body = data.subarray(2 + headerLen)
      if (body.length) {
        if (!parts.length) o.onAudio?.()
        parts.push(body)
      }
    })
  })
}

const HEDGE_IN_FLIGHT = 3
const HEDGE_ATTEMPTS = 8

/**
 * One chunk, hedged. Microsoft's busy voices (the Khmer ones especially) often accept a line, stay silent ~3 s and then
 * drop the connection (1006), while the same line sent again is answered in under a second. So: if no audio has
 * arrived after `hedgeMs`, or an attempt is dropped, the line goes out again alongside; the first complete answer wins.
 */
export function synthHedged(ssmlText: string, o: EdgeSynthOptions, chunk: (t: string, o: ChunkOptions) => Promise<Buffer> = synthChunk): Promise<Buffer> {
  const hedgeMs = o.hedgeMs ?? 1200
  if (!hedgeMs) return chunk(ssmlText, o)
  return new Promise((resolve, reject) => {
    const ctrls: AbortController[] = []
    let attempts = 0
    let inFlight = 0
    let streaming = 0
    let settled = false
    let lastErr: Error | undefined
    let timer: NodeJS.Timeout | undefined
    const end = (err: Error | undefined, buf?: Buffer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', onUserAbort)
      for (const c of ctrls) c.abort()
      if (err) reject(err)
      else resolve(buf!)
    }
    const onUserAbort = () => end(new CanceledError())
    if (o.signal?.aborted) return onUserAbort()
    o.signal?.addEventListener('abort', onUserAbort)

    const launch = () => {
      if (settled || attempts >= HEDGE_ATTEMPTS || inFlight >= HEDGE_IN_FLIGHT) return
      attempts++
      inFlight++
      const ac = new AbortController()
      ctrls.push(ac)
      let mine = false
      chunk(ssmlText, {
        ...o,
        signal: ac.signal,
        onAudio: () => {
          mine = true
          streaming++
          clearTimeout(timer)
        }
      }).then(
        (buf) => end(undefined, buf),
        (e: Error & { status?: number }) => {
          inFlight--
          if (mine) streaming--
          if (settled || e instanceof CanceledError) return
          lastErr = e
          // a refused handshake (clock / token) is not a busy voice: hand it to the caller at once
          if (e.status) return end(e)
          if (attempts < HEDGE_ATTEMPTS) {
            if (!streaming || !inFlight) launch()
          } else if (!inFlight) end(lastErr)
        }
      )
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!streaming) launch()
      }, hedgeMs)
    }
    launch()
  })
}

/** Synthesize text to an MP3 buffer (24 kHz, 48 kbps mono). */
export async function edgeSynthesize(text: string, o: EdgeSynthOptions): Promise<Buffer> {
  const chunks = splitText(escapeXml(cleanText(text)))
  if (!chunks.length) throw new Error('Empty text')
  const out: Buffer[] = []
  for (const chunk of chunks) {
    try {
      out.push(await synthHedged(chunk, o))
    } catch (e) {
      const err = e as Error & { status?: number; date?: string }
      if (err.status !== 403 || !adjustSkew(err.date)) throw err
      out.push(await synthHedged(chunk, o)) // retry once with corrected clock
    }
  }
  return Buffer.concat(out)
}

export interface EdgeBatchItem {
  id: string
  text: string
  voice: string
  rate?: string
  pitch?: string
  volume?: string
  out: string
}

/** Synthesize many lines concurrently with retries; writes each MP3 atomically to `out`. */
export async function edgeSynthBatch(
  items: EdgeBatchItem[],
  opts: { concurrency?: number; retries?: number; hedgeMs?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}
): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
  const results: Array<{ id: string; ok: boolean; error?: string }> = new Array(items.length)
  const retries = opts.retries ?? 4
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      const it = items[i]
      let last: Error | undefined
      for (let attempt = 0; attempt < retries; attempt++) {
        if (opts.signal?.aborted) throw new CanceledError()
        try {
          const audio = await edgeSynthesize(it.text, { voice: it.voice, rate: it.rate, pitch: it.pitch, volume: it.volume, hedgeMs: opts.hedgeMs, signal: opts.signal })
          if (audio.length < 200) throw new Error('empty audio returned')
          mkdirSync(dirname(it.out), { recursive: true })
          const tmp = `${it.out}.part`
          writeFileSync(tmp, audio)
          renameSync(tmp, it.out)
          last = undefined
          break
        } catch (e) {
          last = e as Error
          rmSync(`${it.out}.part`, { force: true })
          if (opts.signal?.aborted) throw new CanceledError()
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
      results[i] = last ? { id: it.id, ok: false, error: last.message } : { id: it.id, ok: true }
      opts.onProgress?.(++done, items.length)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 8, 16, items.length)) }, worker))
  return results
}
