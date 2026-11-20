// Cast helpers: actor stats, cross-episode speaker matching, voice auto-match (pure, unit tested).

import type { Actor, Gender, Segment, Voice } from './types'

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export interface DetectedSpeaker {
  id: string // worker/Gemini label, e.g. "S0" or "A1"
  gender: Gender
  embedding?: number[]
}

/**
 * Map detected speakers onto the project cast. Speakers whose embedding matches an existing actor
 * (cosine ≥ threshold) reuse it; others become new actors A(n+1)…
 */
export function matchSpeakers(
  speakers: DetectedSpeaker[],
  cast: Actor[],
  threshold = 0.75
): { mapping: Record<string, string>; cast: Actor[] } {
  const out = cast.map((a) => ({ ...a }))
  const used = new Set<string>()
  const mapping: Record<string, string> = {}
  let next = out.reduce((m, a) => Math.max(m, Number(a.id.replace(/\D/g, '')) || 0), 0) + 1

  for (const s of speakers) {
    let best: Actor | null = null
    let bestSim = threshold
    if (s.embedding) {
      for (const a of out) {
        if (!a.embedding || used.has(a.id)) continue
        const sim = cosine(s.embedding, a.embedding)
        if (sim >= bestSim) {
          bestSim = sim
          best = a
        }
      }
    }
    // no embedding (e.g. Gemini labels "A1", "A2"): reuse an actor with the same id
    if (!best && !s.embedding) {
      const same = out.find((a) => a.id === s.id && !used.has(a.id))
      if (same) best = same
    }
    if (best) {
      mapping[s.id] = best.id
      used.add(best.id)
      if (best.gender === 'unknown') best.gender = s.gender
      continue
    }
    const id = `A${next++}`
    out.push({ id, label: id, gender: s.gender, lines: 0, totalSec: 0, sampleText: '', embedding: s.embedding })
    mapping[s.id] = id
    used.add(id)
  }
  return { mapping, cast: out }
}

/** Recompute lines / seconds / sample line for each actor from segments. */
export function actorStats(cast: Actor[], segments: Segment[]): Actor[] {
  return cast.map((a) => {
    const mine = segments.filter((s) => s.actorId === a.id)
    const sample = [...mine].sort((x, y) => y.end - y.start - (x.end - x.start))[0]
    return {
      ...a,
      lines: mine.length,
      totalSec: Math.round(mine.reduce((t, s) => t + (s.end - s.start), 0) * 10) / 10,
      sampleText: sample ? sample.textTarget || sample.textOriginal : a.sampleText
    }
  })
}

/** Give male actors distinct male voices and female actors distinct female voices (round-robin). */
export function autoMatchVoices(cast: Actor[], voices: Voice[], locale?: string): Actor[] {
  const pick = (g: Gender) => {
    const pool = voices.filter((v) => v.gender === g && (!locale || v.locale.toLowerCase().startsWith(locale.toLowerCase())))
    return pool.length ? pool : voices.filter((v) => v.gender === g)
  }
  const male = pick('male')
  const female = pick('female')
  let mi = 0
  let fi = 0
  let ui = 0
  // actors with more lines get the first (usually best) voices
  const order = [...cast].sort((a, b) => b.lines - a.lines)
  const assigned = new Map<string, string | undefined>()
  for (const a of order) {
    let v: Voice | undefined
    if (a.gender === 'female') v = female[fi++ % Math.max(1, female.length)]
    else if (a.gender === 'male') v = male[mi++ % Math.max(1, male.length)]
    else {
      const both = [...male, ...female]
      v = both[ui++ % Math.max(1, both.length)]
    }
    assigned.set(a.id, v?.id)
  }
  return cast.map((a) => ({ ...a, voiceId: assigned.get(a.id) ?? a.voiceId }))
}

// ───────── voice variants ─────────

/** A voice id may carry a variant: "edge:km-KH-PisethNeural#-14,0.95" = base voice, pitch offset (Hz), speed factor. */
export function parseVoiceVariant(voice: string): { base: string; pitch: number; rate: number } {
  const [base, fx] = voice.split('#', 2)
  const [p, r] = (fx ?? '').split(',')
  const pitch = Number(p)
  const rate = Number(r)
  return { base, pitch: Number.isFinite(pitch) ? pitch : 0, rate: Number.isFinite(rate) && rate > 0 ? rate : 1 }
}

/** Character voices made from one base voice (Khmer has only one male and one female Edge voice). */
export const VOICE_VARIANTS: Record<Gender, Array<[string, number, number]>> = {
  male: [
    ['Deep', -14, 0.95],
    ['Old', -24, 0.9],
    ['Young', 12, 1.05],
    ['Boy', 30, 1.08]
  ],
  female: [
    ['Soft', -8, 0.95],
    ['Mature', -16, 0.92],
    ['Young', 14, 1.04],
    ['Girl', 30, 1.08]
  ],
  unknown: []
}

/** Base voice first, then its variants, so auto-match gives every actor a different sound. */
export function withVariants(v: Voice): Voice[] {
  return [
    v,
    ...VOICE_VARIANTS[v.gender].map(([label, pitch, rate]) => ({ ...v, id: `${v.id}#${pitch},${rate}`, name: `${v.name.replace(/ \(.*\)$/, '')} – ${label}${v.name.match(/ \(.*\)$/)?.[0] ?? ''}` }))
  ]
}

// ───────── tidy cast ─────────

/**
 * Speaker detection splits one person into many actors. Keep the actors that speak enough (at most maxActors),
 * and move every small actor's lines to the closest kept actor: same gender first, then by voice embedding.
 * Returns the smaller cast and old → new actor ids.
 */
export function tidyCast(cast: Actor[], segments: Segment[], maxActors = 10): { cast: Actor[]; remap: Record<string, string> } {
  const count = new Map<string, number>()
  for (const s of segments) if (s.actorId) count.set(s.actorId, (count.get(s.actorId) ?? 0) + 1)
  const total = [...count.values()].reduce((a, b) => a + b, 0)
  const minLines = Math.max(3, Math.ceil(total * 0.03))
  const ranked = [...cast].sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0))
  const keep = ranked.filter((a, i) => i < maxActors && (count.get(a.id) ?? 0) >= minLines)
  if (!keep.length && ranked.length) keep.push(ranked[0])
  const keepIds = new Set(keep.map((a) => a.id))
  const remap: Record<string, string> = {}
  for (const a of cast) {
    if (keepIds.has(a.id)) continue
    const same = keep.filter((k) => k.gender === a.gender)
    const pool = same.length ? same : keep
    let best = pool[0]
    if (a.embedding) {
      let bestSim = -2
      for (const k of pool) {
        const sim = k.embedding ? cosine(a.embedding, k.embedding) : -1
        if (sim > bestSim) (bestSim = sim), (best = k)
      }
    }
    if (best) remap[a.id] = best.id
  }
  return { cast: cast.filter((a) => keepIds.has(a.id)), remap }
}
