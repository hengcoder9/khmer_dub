// Registers every pipeline step as a queued job type.

import { registerJob } from './queue'
import { ensureAudio, detectSilences } from './pipeline/extract'
import { separate, type SeparatePayload } from './pipeline/separate'
import { transcribe, type TranscribePayload } from './pipeline/transcribe'
import { diarize, type DiarizePayload } from './pipeline/diarize'
import { translate, type TranslatePayload } from './pipeline/translate'
import { tts, type TtsPayload } from './pipeline/tts'
import { mix, type MixPayload } from './pipeline/mix'
import { exportEpisode, type ExportPayload } from './pipeline/export'
import { readScreen, type OcrPayload } from './pipeline/ocr'
import { installEngines } from './pipeline/pysetup'
import { download, type DownloadPayload } from './pipeline/download'
import { getPeaks } from './lib/peaks'

export function registerAllJobs() {
  registerJob<{ videoPath: string; epDir: string; durationSec: number }>('extract', {
    lane: 'cpu',
    label: () => 'Extract audio',
    run: (p, ctx) => ensureAudio(p.videoPath, p.epDir, p.durationSec, ctx)
  })
  registerJob<SeparatePayload>('separate', { lane: 'gpu', label: () => 'Remove BGM (separate vocals)', run: separate })
  registerJob<TranscribePayload>('transcribe', {
    lane: 'gpu',
    label: (p) => `Transcribe (${p.engine})`,
    run: transcribe
  })
  registerJob<DiarizePayload>('diarize', { lane: 'gpu', label: () => 'Detect speakers', run: diarize })
  registerJob<TranslatePayload>('translate', {
    lane: 'net',
    label: (p) => `Translate ${p.items.length} lines (${p.provider})`,
    run: translate
  })
  registerJob<TtsPayload>('tts', { lane: 'gpu', label: (p) => `Generate ${p.items.length} voice lines`, run: tts })
  registerJob<MixPayload>('mix', { lane: 'cpu', label: () => 'Mix dub track', run: mix })
  registerJob<ExportPayload>('export', { lane: 'cpu', label: (p) => `Export ${p.baseName}`, run: exportEpisode })
  registerJob<DownloadPayload>('download', { lane: 'net', label: () => 'Download video from link', run: download })
  registerJob<OcrPayload>('ocr', { lane: 'net', label: () => 'Read screen subtitles', run: readScreen })
  registerJob<{ groups: string[]; force?: boolean }>('engines.install', {
    lane: 'cpu',
    label: (p) => `Install engines: ${p.groups.join(', ')}`,
    run: installEngines
  })
  registerJob<{ path: string; durationSec: number; noiseDb?: number; minDur?: number }>('silences', {
    lane: 'cpu',
    label: () => 'Detect silences',
    run: async (p, ctx) => ({
      silences: await detectSilences(p.path, { noiseDb: p.noiseDb, minDur: p.minDur, durationSec: p.durationSec, signal: ctx.signal })
    })
  })
  registerJob<{ path: string }>('peaks', { lane: 'cpu', label: () => 'Waveform', run: (p) => getPeaks(p.path) })
}
