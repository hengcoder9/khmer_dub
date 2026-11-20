// Optional AI engine groups the user can install from Settings → Engines.

export interface EngineGroup {
  id: string
  label: string
  description: string
  sizeHint: string
  /** python module names that must import for the group to count as installed */
  modules: string[]
  requires?: string[]
}

export const ENGINE_GROUPS: EngineGroup[] = [
  { id: 'core', label: 'Core', description: 'Worker server, Edge-TTS voices, audio I/O', sizeHint: '~60 MB', modules: ['fastapi', 'uvicorn', 'edge_tts', 'numpy', 'soundfile'] },
  { id: 'whisper', label: 'Whisper (speech-to-text)', description: 'faster-whisper, offline transcription with word timestamps', sizeHint: '~250 MB + model 1.5–3 GB', modules: ['faster_whisper'], requires: ['core'] },
  { id: 'torch', label: 'PyTorch', description: 'GPU runtime used by Demucs, speakers and voice cloning', sizeHint: '~2.5 GB (CUDA) / 200 MB (CPU)', modules: ['torch'], requires: ['core'] },
  { id: 'demucs', label: 'Demucs (remove BGM)', description: 'Separate vocals from music & effects', sizeHint: '~100 MB + model 80 MB', modules: ['demucs'], requires: ['torch'] },
  { id: 'diarization', label: 'Speakers & gender', description: 'Voice embeddings (Resemblyzer), clustering, pitch-based gender', sizeHint: '~150 MB', modules: ['resemblyzer', 'librosa', 'sklearn'], requires: ['torch'] },
  { id: 'translate', label: 'Offline translation', description: 'NLLB-200 600M via CTranslate2 (no internet needed after download)', sizeHint: '~80 MB + model 650 MB', modules: ['ctranslate2', 'sentencepiece', 'huggingface_hub'], requires: ['core'] },
  { id: 'clone', label: 'Voice cloning (F5-TTS)', description: 'Local voice cloning from a 5–15 s reference clip', sizeHint: '~1 GB + model 1.3 GB', modules: ['f5_tts'], requires: ['torch'] }
]
