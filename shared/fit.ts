// Auto-fit math: squeeze each TTS clip into its subtitle slot (pure, unit tested).

export interface FitInput {
  ttsDur: number
  start: number
  end: number
  /** start of the next segment, if any */
  nextStart?: number
  /** media duration, caps the slot at the end of the video */
  mediaEnd?: number
  syncEnd: boolean
  maxSpeed: number
}

export interface FitResult {
  slot: number
  speed: number
  fitWarning: boolean
}

export const GAP = 0.05

/** Seconds available for the line. With syncEnd it may run on into the silence before the next line. */
export function slotFor(i: Pick<FitInput, 'start' | 'end' | 'nextStart' | 'mediaEnd' | 'syncEnd'>): number {
  let end = i.end
  if (i.syncEnd) {
    const limit = i.nextStart !== undefined ? i.nextStart - GAP : (i.mediaEnd ?? i.end)
    end = Math.max(i.end, limit)
  }
  if (i.mediaEnd !== undefined) end = Math.min(end, i.mediaEnd)
  return Math.max(0.05, end - i.start)
}

export function computeFit(i: FitInput): FitResult {
  const slot = slotFor(i)
  const ratio = i.ttsDur / slot
  if (ratio <= 1) return { slot, speed: 1, fitWarning: false }
  if (ratio <= i.maxSpeed) return { slot, speed: round3(ratio), fitWarning: false }
  return { slot, speed: i.maxSpeed, fitWarning: true }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** ffmpeg atempo accepts 0.5–2.0 per instance; chain for larger factors. */
export function atempoChain(speed: number): string {
  if (!(speed > 0)) throw new Error('speed must be > 0')
  const parts: number[] = []
  let s = speed
  while (s > 2) {
    parts.push(2)
    s /= 2
  }
  while (s < 0.5) {
    parts.push(0.5)
    s /= 0.5
  }
  parts.push(round3(s))
  return parts.map((p) => `atempo=${p}`).join(',')
}

/** Edge-TTS rate string: 1.25 → "+25%", 0.9 → "-10%". */
export function edgeRate(speed: number): string {
  const pct = Math.round((speed - 1) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

/** Edge-TTS pitch string in Hz: 0 → "+0Hz". */
export const edgePitch = (hz: number) => `${hz >= 0 ? '+' : ''}${Math.round(hz)}Hz`
