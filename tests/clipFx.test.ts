import { describe, expect, it } from 'vitest'
import type { Clip } from '../shared/types'
import {
  effectiveClips,
  explodeClips,
  layoutClips,
  mapCuesToOutput,
  outputDuration,
  outputToSource,
  rangeToOutput,
  sourceToOutput,
  splitClipAt,
  transitionDur,
  trimClipEdge
} from '../shared/ranges'

describe('clip speed', () => {
  const clips: Clip[] = [
    { id: 'a', start: 0, end: 10, speed: 2 },
    { id: 'b', start: 20, end: 30 }
  ]
  it('shortens the output', () => {
    expect(outputDuration(clips)).toBe(15)
    expect(layoutClips(clips).map((p) => [p.outStart, p.outLen])).toEqual([
      [0, 5],
      [5, 10]
    ])
  })
  it('maps times both ways', () => {
    expect(sourceToOutput(4, clips)).toBe(2)
    expect(sourceToOutput(25, clips)).toBe(10)
    expect(outputToSource(2, clips)).toBe(4)
    expect(outputToSource(10, clips)).toBe(25)
  })
  it('re-times cues inside a fast clip', () => {
    expect(mapCuesToOutput([{ start: 2, end: 6, text: 'x' }], clips)).toEqual([{ start: 1, end: 3, text: 'x' }])
  })
  it('gives the output span of a source range', () => {
    expect(rangeToOutput({ start: 2, end: 6 }, layoutClips(clips))).toEqual({ start: 1, end: 3, speed: 2 })
    expect(rangeToOutput({ start: 12, end: 15 }, layoutClips(clips))).toBeNull()
  })
})

describe('transitions', () => {
  const clips: Clip[] = [
    { id: 'a', start: 0, end: 10, transition: { type: 'fade', duration: 1 } },
    { id: 'b', start: 20, end: 30 }
  ]
  it('overlaps the clips', () => {
    expect(transitionDur(clips, 0)).toBe(1)
    expect(transitionDur(clips, 1)).toBe(0) // last clip: nothing to go into
    expect(layoutClips(clips)[1].outStart).toBe(9)
    expect(outputDuration(clips)).toBe(19)
  })
  it('never takes more than half a clip', () => {
    const short: Clip[] = [{ id: 'a', start: 0, end: 1, transition: { type: 'fade', duration: 2 } }, { id: 'b', start: 5, end: 9 }]
    expect(transitionDur(short, 0)).toBe(0.5)
  })
  it('prefers the incoming clip inside the overlap', () => {
    expect(outputToSource(9.5, clips)).toBe(20.5)
  })
})

describe('explode / split / trim', () => {
  it('turns pieces into base clips without changing the result', () => {
    const edit = { clips: [{ id: 'c0', start: 0, end: 30, speed: 1.5, transition: { type: 'fade' as const, duration: 0.5 } }], removed: [{ start: 10, end: 12 }] }
    const before = effectiveClips(edit)
    const clips = explodeClips(edit)
    expect(clips.map((c) => [c.id, c.start, c.end])).toEqual([
      ['c0', 0, 12],
      ['c0.1', 12, 30]
    ])
    expect(clips[0].transition).toBeUndefined()
    expect(clips[1].transition).toEqual({ type: 'fade', duration: 0.5 })
    expect(effectiveClips({ clips, removed: edit.removed })).toEqual(before)
  })
  it('split keeps settings on both halves', () => {
    const out = splitClipAt([{ id: 'a', start: 0, end: 10, speed: 2, volume: 0.5, transition: { type: 'fade', duration: 1 } }], 4, 'b')
    expect(out).toEqual([
      { id: 'a', start: 0, end: 4, speed: 2, volume: 0.5 },
      { id: 'b', start: 4, end: 10, speed: 2, volume: 0.5, transition: { type: 'fade', duration: 1 } }
    ])
  })
  it('drag-trims edges in and out', () => {
    const edit = { clips: [{ id: 'a', start: 0, end: 10 }], removed: [] }
    const shrunk = trimClipEdge(edit, 'a', 'r', 7, 60)
    expect(effectiveClips(shrunk)).toEqual([{ id: 'a', start: 0, end: 7 }])
    const grown = trimClipEdge(shrunk, 'a', 'r', 15, 60)
    expect(effectiveClips(grown)).toEqual([{ id: 'a', start: 0, end: 15 }])
    const left = trimClipEdge(grown, 'a', 'l', 3, 60)
    expect(effectiveClips(left)).toEqual([{ id: 'a', start: 3, end: 15 }])
    expect(effectiveClips(trimClipEdge(left, 'a', 'l', -5, 60))).toEqual([{ id: 'a', start: 0, end: 15 }])
  })
})

describe('auto original sound', () => {
  it('merges dub lines with short gaps, keeps short lines', async () => {
    const { dubSpans, dubOnExpr } = await import('../shared/ranges')
    expect(dubSpans([{ start: 5, dur: 0.2 }, { start: 1, dur: 2 }, { start: 3.2, dur: 1 }], 0.35)).toEqual([
      { start: 1, end: 4.2 },
      { start: 5, end: 5.2 }
    ])
    expect(dubOnExpr([])).toBe('0')
    expect(dubOnExpr([{ start: 1, end: 2 }], 0.1)).toBe('min(1,clip((t-0.900)/0.100,0,1)*clip((2.100-t)/0.100,0,1))')
  })
  it('preview curve matches: fades in before the line, full under it, fades out after', async () => {
    const { dubOnAt } = await import('../shared/ranges')
    const sp = [{ start: 10, end: 12 }]
    expect(dubOnAt(sp, 9)).toBe(0)
    expect(dubOnAt(sp, 9.85)).toBeCloseTo(0.5)
    expect(dubOnAt(sp, 11)).toBe(1)
    expect(dubOnAt(sp, 12.15)).toBeCloseTo(0.5)
    expect(dubOnAt(sp, 13)).toBe(0)
  })
})

describe('export resolution', () => {
  it('scales by the short side, any format', async () => {
    const { outputSize } = await import('../shared/ranges')
    expect(outputSize('source', 1920, 1080)).toEqual({ w: 1920, h: 1080 })
    expect(outputSize('source', 1920, 1080, 720)).toEqual({ w: 1280, h: 720 })
    expect(outputSize('source', 1920, 1080, 2160)).toEqual({ w: 3840, h: 2160 })
    expect(outputSize('9:16', 1920, 1080, 1080)).toEqual({ w: 1080, h: 1920 })
    expect(outputSize('9:16', 1920, 1080, 1440)).toEqual({ w: 1440, h: 2560 })
    expect(outputSize('1:1', 1920, 1080)).toEqual({ w: 1080, h: 1080 })
  })
})
