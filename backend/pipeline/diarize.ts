import type { Gender } from '../../shared/types'
import { aiWorker } from '../lib/python'
import { ensureAudio } from './extract'
import type { JobCtx } from '../queue'

export interface DiarizePayload {
  videoPath: string
  epDir: string
  durationSec: number
  segments: Array<{ id: string; start: number; end: number }>
  vocalsPath?: string
  /** cosine similarity needed to treat two lines as the same speaker */
  threshold?: number
  numSpeakers?: number
}

export interface DiarizeResult {
  assign: Record<string, string>
  speakers: Array<{ id: string; gender: Gender; f0: number; embedding: number[] }>
}

/** Offline speakers: voice embeddings per line → agglomerative clustering; gender from median F0 (pyin). */
export async function diarize(p: DiarizePayload, ctx: JobCtx): Promise<DiarizeResult> {
  const { audio16k } = await ensureAudio(p.videoPath, p.epDir, p.durationSec, ctx, [0, 5])
  return aiWorker.job<DiarizeResult>(
    'diarize',
    {
      audio: audio16k,
      pitch_audio: p.vocalsPath ?? audio16k,
      segments: p.segments,
      threshold: p.threshold ?? 0.7,
      num_speakers: p.numSpeakers ?? null
    },
    ctx,
    [5, 100]
  )
}
