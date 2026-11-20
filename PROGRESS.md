# Build progress

Scope: full spec (BUILD_PROMPT.md Phases 1–10) + AI video editor (text-based cutting, timeline basics,
AI prompt edits, styled captions). Pace: build everything, verify, then hand over.

## Architecture decisions
- Renderer (Zustand) is the single source of truth for the project; backend jobs receive what they need in the
  payload and return results, which the renderer applies (undoable) and autosaves (POST /projects/save, 1 s debounce).
- Pure logic in `shared/` (srt, fit, segments, ranges/edit-list, translate, captions/ASS, cast, editor) with vitest tests.
- Python workers (`workers/`) are FastAPI apps on 127.0.0.1 with a per-launch token; started lazily, killed on quit,
  and they exit by themselves when the backend's PID disappears.
- Python env is installed by the app into `%APPDATA%/KhmerDub Studio/python` (embedded 3.10) — not into Program Files.
- API keys: Electron `safeStorage` (Windows DPAPI) in main → pushed to backend memory; never in project.json/logs.
  (keytar is archived and needs native rebuilds; safeStorage is the OS-keychain equivalent built into Electron.)
- Gemini audio is sent inline (chunks ≤ 5 min, 32 kbps mono) instead of the Files API, so key rotation works per request.
- Timeline waveforms are drawn on canvas from backend-computed peaks (wavesurfer decodes whole files in the browser,
  which does not scale to hour-long episodes).
- Diarization uses Resemblyzer embeddings per line + agglomerative clustering (weights ship in the pip package; no HF token).
- Edit model: `edit.clips` (user order) minus `edit.removed` ranges = output. Dub/mix run on source time; export
  applies the edit list to video + mix + re-timed captions.
- i18n: English is inline as `t(key, default)`; Khmer in `src/i18n/km.tsv` → `npm run i18n` → km.json.

## Status (2026-11-20)
- [x] All phases + AI editor implemented; 48 unit tests; both typechecks clean; installer builds (dist/).
- Verified for real: core engine install (embedded Python + Edge-TTS), Khmer TTS + auto-fit, mix + ducking,
  edited 9:16 export with karaoke burn-in (Khmer renders correctly), SRT retime, UI screenshots (en + km),
  packaged app backend starts.
- Not verified (needs API key / multi-GB engines): Gemini transcribe/translate/OCR/AI-edit/shorten, OpenRouter,
  Whisper, Demucs, diarization, NLLB, F5-TTS cloning, auto-update (needs GitHub repo in electron-builder.yml).
- Dev smoke test: `KD_SHOTS` env in electron/main.ts (dev only) + `window.__kd` handles in src/main.tsx.

## Speed pass (2026-11-20)
- Gemini transcribe: chunk 1 first (speaker labels), remaining chunks in parallel. Translate and Read Screen batches
  in parallel. Parallelism = 3 per API key, 2–8 (`shared/parallel.ts`); 429s still go through key cooldown + retry.
- Whisper: default model large-v3-turbo for new projects; BatchedInferencePipeline (batch 12) on CUDA, sequential fallback.
- Demucs on CPU: `-j` up to 4. Edge-TTS: 8 parallel requests (was 5).
- Missing Python module errors → "Engine not installed: … install <group>".
