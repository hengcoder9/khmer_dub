// WAV helpers + streaming dub-track mixer (no full-length buffers in memory).

import { open, type FileHandle } from 'node:fs/promises'

export const SR = 44100

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  dataOffset: number
  dataBytes: number
  duration: number
}

/** Parse RIFF chunks to find fmt/data (ffmpeg may write LIST chunks before data). */
export async function readWavInfo(path: string): Promise<WavInfo> {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    const head = Buffer.alloc(Math.min(size, 65536))
    await fh.read(head, 0, head.length, 0)
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`Not a WAV file: ${path}`)
    let pos = 12
    let fmt: Omit<WavInfo, 'dataOffset' | 'dataBytes' | 'duration'> | null = null
    while (pos + 8 <= head.length) {
      const id = head.toString('ascii', pos, pos + 4)
      const len = head.readUInt32LE(pos + 4)
      if (id === 'fmt ') {
        fmt = { channels: head.readUInt16LE(pos + 10), sampleRate: head.readUInt32LE(pos + 12), bitsPerSample: head.readUInt16LE(pos + 22) }
      } else if (id === 'data') {
        if (!fmt) throw new Error('WAV data before fmt')
        const dataOffset = pos + 8
        // ffmpeg writes 0xFFFFFFFF / 0 when streaming; trust the file size instead
        const dataBytes = len === 0 || len === 0xffffffff || dataOffset + len > size ? size - dataOffset : len
        const bps = (fmt.bitsPerSample / 8) * fmt.channels
        return { ...fmt, dataOffset, dataBytes, duration: dataBytes / bps / fmt.sampleRate }
      }
      pos += 8 + len + (len % 2)
    }
    throw new Error(`No data chunk in ${path}`)
  } finally {
    await fh.close()
  }
}

export function wavHeader(samples: number, sampleRate = SR, channels = 1): Buffer {
  const dataBytes = samples * channels * 2
  const b = Buffer.alloc(44)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + dataBytes, 4)
  b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(channels, 22)
  b.writeUInt32LE(sampleRate, 24)
  b.writeUInt32LE(sampleRate * channels * 2, 28)
  b.writeUInt16LE(channels * 2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(dataBytes, 40)
  return b
}

export interface MixClip {
  path: string // 44.1 kHz mono s16 WAV
  start: number // seconds
  gain: number
}

/**
 * Place clips on a silent mono track of `duration` seconds and write a 16-bit WAV.
 * Processes in blocks, reading only the overlapping part of each clip.
 */
export async function mixDub(clips: MixClip[], duration: number, outPath: string, onProgress?: (pct: number) => void): Promise<void> {
  const total = Math.ceil(duration * SR)
  const infos: Array<MixClip & { info: WavInfo; startSample: number; samples: number; fh: FileHandle }> = []
  try {
    for (const c of clips) {
      const info = await readWavInfo(c.path)
      if (info.sampleRate !== SR || info.channels !== 1 || info.bitsPerSample !== 16) {
        throw new Error(`Clip must be 44.1 kHz mono 16-bit: ${c.path}`)
      }
      const startSample = Math.max(0, Math.round(c.start * SR))
      infos.push({ ...c, info, startSample, samples: info.dataBytes / 2, fh: await open(c.path, 'r') })
    }
    infos.sort((a, b) => a.startSample - b.startSample)

    const out = await open(outPath, 'w')
    try {
      await out.write(wavHeader(total))
      const BLOCK = SR * 4
      const acc = new Float32Array(BLOCK)
      const readBuf = Buffer.alloc(BLOCK * 2)
      const outBuf = Buffer.alloc(BLOCK * 2)
      let first = 0
      for (let b0 = 0; b0 < total; b0 += BLOCK) {
        const n = Math.min(BLOCK, total - b0)
        acc.fill(0, 0, n)
        while (first < infos.length && infos[first].startSample + infos[first].samples <= b0) first++
        for (let i = first; i < infos.length; i++) {
          const c = infos[i]
          if (c.startSample >= b0 + n) break
          const s = Math.max(b0, c.startSample)
          const e = Math.min(b0 + n, c.startSample + c.samples)
          if (e <= s) continue
          const count = e - s
          await c.fh.read(readBuf, 0, count * 2, c.info.dataOffset + (s - c.startSample) * 2)
          const off = s - b0
          for (let k = 0; k < count; k++) acc[off + k] += readBuf.readInt16LE(k * 2) * c.gain
        }
        for (let k = 0; k < n; k++) {
          const v = acc[k]
          outBuf.writeInt16LE(v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v), k * 2)
        }
        await out.write(outBuf, 0, n * 2)
        onProgress?.(((b0 + n) / total) * 100)
      }
    } finally {
      await out.close()
    }
  } finally {
    await Promise.all(infos.map((c) => c.fh.close().catch(() => {})))
  }
}
