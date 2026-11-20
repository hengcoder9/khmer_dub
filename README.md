# KhmerDub Studio

AI video dubbing + AI video editing desktop app for Windows — Khmer first, works for other languages too.

## Quick start (development)

```powershell
npm install
npm run fetch:assets   # ffmpeg/ffprobe → resources/bin, Khmer fonts → resources/fonts
npm run dev            # starts the app with hot reload
```

In the app: **Settings → Engines → Install recommended** (downloads an embedded Python 3.10 and the AI engines
into `%APPDATA%\KhmerDub Studio\python`), then **Settings → API Keys** to add Gemini key(s).

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the app (clears `ELECTRON_RUN_AS_NODE`, which VS Code sets) |
| `npm test` | Unit tests (SRT/VTT, auto-fit, translation chunking/validation, edit lists, captions, cast, mixer, key pool) |
| `npm run typecheck` | TypeScript for main/backend and renderer |
| `npm run dist` | Build the NSIS installer into `dist/` |
| `npm run i18n` | Rebuild `src/i18n/km.json` from `src/i18n/km.tsv` (English lives inline as `t()` defaults) |
| `npm run icon` | Regenerate `build/icon.png` |

## Workflow

1. **New project** → pick one video, or many for a series (one episode tab per video: E01, E02 …).
2. **Remove BGM** (Demucs) → instrumental on track A2.
3. **Transcribe** — Direct (Gemini: transcript + Khmer + speakers + gender in one pass), Whisper + Translate,
   Gemini Transcribe + Cast, or fully Offline (Whisper + local speakers + NLLB). **Read Screen** OCRs burned-in subtitles.
4. Edit lines in the grid; **Cast** → Auto-match gives each actor a distinct voice (shared across episodes).
5. **Generate Audio** — Edge-TTS or local voice clones; every line is auto-fitted to its slot
   (engine rate first, `atempo` fallback). ▲ = too fast → click to let AI shorten the line.
6. **Export** — dub mixed over the instrumental with sidechain ducking, loudness −14 LUFS, MP4 (NVENC/QSV/AMF or x264),
   SRT/VTT/ASS, voice-only and instrumental stems. **Automate** runs all of it for many episodes.

### AI Video Editor tab
- **AI edit command** — "make a 60 s TikTok", "remove bad takes"… → the LLM proposes a plan you approve.
- **Quick clean-up** — remove silences (level / min pause), remove filler words (um, uh, អឺ…).
- **Edit by text** — click transcript lines to cut/restore them.
- **Clips** — split at playhead, reorder by drag, delete.
- **Format** — 16:9 / 9:16 / 1:1 / 4:5 with crop, black bars or blurred background; fades; background music.
- **Captions** — presets (Classic, Bold Yellow, Karaoke, Word Pop, Boxed, Minimal), live preview, burned in with libass
  using the bundled Kantumruy Pro / Hanuman fonts (Khmer word timing via ICU word segmentation).

## Architecture

```
electron/   main process: window, backend (utilityProcess), keys (safeStorage/DPAPI), auto-update
backend/    Fastify on 127.0.0.1 (random port + per-launch token), job queue + WebSocket progress
  pipeline/ extract · separate · transcribe · diarize · translate · tts(+fit) · mix · export · ocr · aiedit · pysetup
workers/    Python FastAPI workers: ai_worker (whisper, demucs, speakers, edge-tts, NLLB), clone_worker (F5-TTS lanes)
shared/     pure logic used by both sides (+ unit tests in tests/)
src/        React renderer (Zustand, Tailwind, Radix, i18next km/en)
```

- The renderer owns the project state (undo/redo 100 steps, autosave 1 s) and saves `project.json` in the project folder;
  job results come back over the WebSocket and are applied to the project.
- API keys never touch project files or logs: encrypted in `%APPDATA%\KhmerDub Studio\keys.dat`, pushed to the backend in memory.
- Every external process gets its arguments as an array, so Khmer/Unicode paths with spaces are safe.

## Auto-update
Set `publish.owner`/`repo` in `electron-builder.yml`, then publish with `GH_TOKEN=… npm run dist -- --publish always`.
Installed apps check GitHub Releases on start and offer **Download & Install**.

## Licences
ffmpeg is a GPL build (BtbN) — check the licence before selling the installer. Fonts are OFL. AI models keep their own licences
(Whisper MIT, Demucs MIT, NLLB CC-BY-NC, F5-TTS CC-BY-NC weights).
