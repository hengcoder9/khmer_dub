// Draws the app icon (teal rounded square + white sound bars) as build/icon.png (512x512) — no design tools needed.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const S = 512
const px = Buffer.alloc(S * S * 4)
const set = (x, y, r, g, b, a) => {
  const i = (y * S + x) * 4
  // alpha-over onto existing pixel
  const ia = px[i + 3] / 255
  const na = a / 255
  const oa = na + ia * (1 - na)
  if (oa <= 0) return
  px[i] = Math.round((r * na + px[i] * ia * (1 - na)) / oa)
  px[i + 1] = Math.round((g * na + px[i + 1] * ia * (1 - na)) / oa)
  px[i + 2] = Math.round((b * na + px[i + 2] * ia * (1 - na)) / oa)
  px[i + 3] = Math.round(oa * 255)
}

// signed distance to a rounded rectangle, used for anti-aliased edges
const rrect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r
  const qy = Math.abs(y - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

const bars = [0.32, 0.55, 0.85, 0.62, 0.95, 0.5, 0.72, 0.38]
const barW = 26
const gap = 16
const totalW = bars.length * barW + (bars.length - 1) * gap
const x0 = S / 2 - totalW / 2

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    // background: vertical teal gradient
    const d = rrect(x + 0.5, y + 0.5, S / 2, S / 2, S / 2 - 16, S / 2 - 16, 112)
    const cov = Math.max(0, Math.min(1, 0.5 - d))
    if (cov > 0) {
      const t = y / S
      set(x, y, Math.round(20 + 10 * t), Math.round(184 - 40 * t), Math.round(166 - 30 * t), Math.round(255 * cov))
    }
    // bars
    for (let i = 0; i < bars.length; i++) {
      const cx = x0 + i * (barW + gap) + barW / 2
      const hh = (bars[i] * 300) / 2
      const db = rrect(x + 0.5, y + 0.5, cx, S / 2, barW / 2, hh, barW / 2)
      const c = Math.max(0, Math.min(1, 0.5 - db))
      if (c > 0) set(x, y, 255, 255, 255, Math.round(245 * c))
    }
  }
}

// PNG encode
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`icon → ${out}`)
