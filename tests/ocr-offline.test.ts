import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { runFfmpeg } from '../backend/lib/ffmpeg'

// stand-ins: the engine is "installed", the Python worker reads every frame as a known subtitle
vi.mock('../backend/pipeline/pysetup', () => ({ engineStatus: vi.fn(async () => ({ ocr: true })) }))
const workerCalls: Array<{ kind: string; images: string[] }> = []
vi.mock('../backend/lib/python', () => ({
  aiWorker: {
    job: vi.fn(async (kind: string, p: { images: string[] }) => {
      workerCalls.push({ kind, images: p.images })
      // frames 0–3 s: "你好"; 4 s on: "再见"; frame 2 has a low-res reading difference
      return { results: p.images.map((_, i) => ({ text: i < 4 ? (i === 2 ? '你好。' : '你好') : '再见', lines: [{ text: 'x', score: 0.9, box: [0.2, 0.82, 0.8, 0.9] }] })) }
    })
  }
}))

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

describe('offline screen reader', () => {
  it('reads the frames on this PC (no AI key) and merges them into timed lines', async () => {
    const { readScreen } = await import('../backend/pipeline/ocr')
    const dir = mkdtempSync(join(tmpdir(), 'kd-ocroff-'))
    const vid = join(dir, 'v.mp4')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=10', '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', vid])
    try {
      const r = await readScreen({ videoPath: vid, epDir: dir, durationSec: 8, interval: 1, cropTop: 0.7, geminiModel: 'g', provider: 'offline' }, ctx)
      expect(workerCalls[0].kind).toBe('ocr')
      expect(workerCalls[0].images.length).toBeGreaterThanOrEqual(7)
      expect(r.segments.map((s) => s.text)).toEqual(['你好', '再见'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('finds the subtitle band from the text boxes (offline "Find it for me")', async () => {
    const { bandFromBoxes } = await import('../backend/pipeline/ocr')
    const b = bandFromBoxes([
      [{ text: 'LOGO', score: 0.9, box: [0.02, 0.02, 0.15, 0.06] }, { text: 'hi', score: 0.9, box: [0.3, 0.82, 0.7, 0.88] }],
      [{ text: 'there', score: 0.9, box: [0.25, 0.83, 0.75, 0.9] }],
      []
    ])
    expect(b!.top).toBeCloseTo(0.8, 5)
    expect(b!.bottom).toBeCloseTo(0.92, 5)
    expect(bandFromBoxes([[{ text: 'only once', score: 0.9, box: [0.3, 0.8, 0.7, 0.9] }], []])).toBeNull()
  })

  it('python: OCR boxes in reading order, low-confidence boxes dropped', () => {
    const code = [
      'import sys, json',
      "sys.path.insert(0, r'" + join(process.cwd(), 'workers') + "')",
      'from ocr import order_lines',
      // two subtitle rows, the right half of row 1 listed first, one low-score box
      'res = [[[[400,500],[600,500],[600,540],[400,540]], "how are", 0.95], [[[100,502],[380,502],[380,540],[100,540]], "Hello,", 0.97], [[[150,560],[450,560],[450,600],[150,600]], "you?", 0.9], [[[10,10],[40,10],[40,30],[10,30]], "noise", 0.2]]',
      'text, lines = order_lines(res, 640, 640)',
      'print(json.dumps({"text": text, "n": len(lines), "box": [l for l in lines if l["text"] == "Hello,"][0]["box"]}))'
    ].join('\n')
    const r = spawnSync('python', ['-c', code], { encoding: 'utf8' })
    if (r.error || r.status !== 0) return // no system Python here: covered when the engine runs
    const out = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()!)
    expect(out.text).toBe('Hello, how are you?')
    expect(out.n).toBe(3)
    expect(out.box[1]).toBeCloseTo(502 / 640, 4)
  })
})
