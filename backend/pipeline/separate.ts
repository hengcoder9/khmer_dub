import { join } from 'node:path'
import { torchWorker } from '../lib/python'
import { ensureAudio, fresh } from './extract'
import type { JobCtx } from '../queue'

export interface SeparatePayload {
  videoPath: string
  epDir: string
  durationSec: number
  device?: 'auto' | 'cuda' | 'cpu'
}

/** demucs htdemucs two-stems → vocals.wav + instrumental.wav (track A2). */
export async function separate(p: SeparatePayload, ctx: JobCtx) {
  const { full, audio16k } = await ensureAudio(p.videoPath, p.epDir, p.durationSec, ctx, [0, 10])
  const vocals = join(p.epDir, 'vocals.wav')
  const instrumental = join(p.epDir, 'instrumental.wav')
  if (!(fresh(vocals, full) && fresh(instrumental, full))) {
    ctx.progress(10, 'Separating vocals (demucs)')
    await torchWorker.job('separate', { input: full, vocals, instrumental, device: p.device ?? 'auto' }, ctx, [10, 100])
  }
  return { full, audio16k, vocals, instrumental }
}
