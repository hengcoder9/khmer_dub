import { describe, expect, it } from 'vitest'
import { friendlyWorkerError } from '../backend/lib/python'

describe('friendlyWorkerError', () => {
  it('names the engine group for a missing module', () => {
    expect(friendlyWorkerError('demucs failed: C:/py/python.exe: No module named demucs')).toBe(
      'Engine not installed: open Settings → Engines and install "Demucs (remove BGM)".'
    )
    expect(friendlyWorkerError("ModuleNotFoundError: No module named 'faster_whisper.transcribe'")).toContain('Whisper')
  })
  it('passes other errors through', () => {
    expect(friendlyWorkerError('CUDA out of memory')).toBe('CUDA out of memory')
  })
})
