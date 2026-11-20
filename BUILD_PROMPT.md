# Build Prompt — KhmerDub Studio (AI Video Dubbing Desktop App)

> Paste this whole file into Claude Code (or save it as `CLAUDE.md` in an empty folder and say:
> "Read CLAUDE.md and build Phase 1"). Build **one phase at a time** and test before moving on.
> Rename "KhmerDub Studio" to your own brand. Use your own logo, colors and wording — do not copy
> another product's name, logo, screenshots or code.

---

## 0. Goal

Build a Windows desktop app that dubs videos into **Khmer** (and other languages) with AI:

1. Import a video (mp4/mkv/mov) or an existing SRT/VTT.
2. Separate vocals from background (music + effects).
3. Transcribe speech with timestamps.
4. Detect speakers (Actor 1..N) and their gender.
5. Translate every line to Khmer with a consistent character-name glossary.
6. Let the user edit lines in a grid, assign a voice per actor, adjust speed per line.
7. Generate speech per line (Edge-TTS, or local voice cloning).
8. Auto-fit each voice clip into its time slot.
9. Mix dub voices over the instrumental with ducking.
10. Export dubbed MP4, SRT/VTT, and audio stems. Support multi-episode projects (E01, E02, …) and batch "Automate".

---

## 1. Tech stack (use exactly this)

| Layer | Choice |
|---|---|
| Desktop shell | Electron 32+ with `electron-vite` |
| UI | React 18 + TypeScript + Tailwind CSS + shadcn/ui + lucide-react icons |
| State | Zustand (with `persist` for settings) |
| Timeline waveforms | wavesurfer.js v7 (+ regions plugin) |
| Main backend | Node.js 20 local HTTP server (Fastify) started by Electron main process, port auto-picked, bound to 127.0.0.1 only |
| Job queue | In-process queue (p-queue) with progress events over WebSocket |
| Media | ffmpeg + ffprobe (bundled static builds in `resources/bin/`) |
| Python workers | Embedded Python 3.10 (`resources/python/`) running small FastAPI workers |
| STT | `faster-whisper` (local, CUDA if available, else CPU int8) and Gemini API (cloud) |
| Vocal separation | `demucs` (htdemucs, two-stems=vocals) |
| Diarization | `pyannote.audio` 3.x OR `sherpa-onnx` speaker embeddings + clustering (offline) |
| Gender | Pitch (F0 via `librosa.pyin`) heuristic + optional small classifier |
| Translation | Gemini API, OpenRouter API (OpenAI-compatible), offline (NLLB-200 via CTranslate2) |
| TTS | `edge-tts` (cloud, free), plus a pluggable local voice-cloning engine (e.g. VoxCPM / F5-TTS / XTTS-v2) |
| Storage | Project folder on disk + `project.json`; settings in electron-store; API keys in OS keychain via `keytar` |
| Packaging | electron-builder (NSIS installer) + electron-updater (GitHub Releases) |
| i18n | i18next — Khmer (km) and English (en) UI |

---

## 2. Folder structure

```
khmerdub-studio/
├─ electron/
│  ├─ main.ts            # window, spawn backend, auto-updater, IPC
│  └─ preload.ts         # safe bridge: openFile, saveFile, getBackendPort
├─ backend/              # Node 20 Fastify server
│  ├─ server.ts
│  ├─ routes/            # projects, segments, jobs, media, settings, health
│  ├─ pipeline/
│  │  ├─ extract.ts      # ffmpeg audio extraction
│  │  ├─ separate.ts     # calls python worker: demucs
│  │  ├─ transcribe.ts   # whisper worker | gemini
│  │  ├─ diarize.ts
│  │  ├─ translate.ts    # gemini | openrouter | offline, chunked
│  │  ├─ tts.ts          # edge | clone engine
│  │  ├─ fit.ts          # duration fitting / atempo
│  │  ├─ mix.ts          # build dub track + ducking
│  │  └─ export.ts       # mux mp4, burn subs, srt/vtt
│  ├─ lib/ffmpeg.ts      # spawn wrapper with progress parsing (-progress pipe:1)
│  ├─ lib/srt.ts         # parse/serialize SRT + VTT
│  ├─ lib/keys.ts        # API key pool w/ rotation + cooldown on 429
│  └─ queue.ts
├─ workers/              # Python
│  ├─ stt_worker.py      # faster-whisper
│  ├─ sep_worker.py      # demucs
│  ├─ diar_worker.py     # diarization + gender
│  ├─ tts_edge.py        # edge-tts batch
│  ├─ clone_worker.py    # local voice cloning server
│  └─ requirements.txt
├─ src/                  # React renderer
│  ├─ app/  components/  features/{grid,timeline,cast,player,settings,automate}
│  └─ i18n/{km,en}.json
└─ resources/bin/ffmpeg.exe, ffprobe.exe ; resources/python/
```

---

## 3. Data model (`project.json`)

```ts
type Project = {
  id: string; name: string;
  episodes: Episode[];             // tabs E01..E09 at bottom of UI
  glossary: { source: string; target: string }[];   // character names, shared across episodes
  cast: Actor[];                   // shared across episodes
  settings: { targetLang: 'km'; sourceLang: 'auto' | string; maxSpeed: number /*1.6*/;
              ducking: boolean; duckLevelDb: number; syncEnd: boolean; };
};
type Episode = {
  id: string; label: string;       // "E02"
  videoPath: string; durationSec: number;
  stems: { full?: string; vocals?: string; instrumental?: string; audio16k?: string };
  segments: Segment[];
  status: 'new'|'separated'|'transcribed'|'translated'|'voiced'|'mixed'|'exported';
};
type Segment = {
  id: string; index: number;
  start: number; end: number;      // seconds, 2-decimal precision
  textOriginal: string;
  textTarget: string;              // Khmer
  actorId?: string;                // A1..An
  voiceId?: string;                // overrides actor voice
  speed: number;                   // 1.0 default; computed by fit step
  pitch: number; volume: number;
  audioPath?: string; audioDur?: number;
  fitWarning?: boolean;            // true when speed > maxSpeed
  selected?: boolean;
};
type Actor = { id: string; label: string; name?: string; gender: 'male'|'female'|'unknown';
               voiceId?: string; lines: number; totalSec: number; sampleText: string };
```

Autosave project.json (debounced 1s). Keep undo/redo history (last 100 states) for segment edits.

---

## 4. Pipeline — implement each step exactly

### 4.1 Extract
```bash
ffprobe -v error -show_entries format=duration -of json in.mp4
ffmpeg -y -i in.mp4 -vn -ac 2 -ar 44100 full.wav
ffmpeg -y -i in.mp4 -vn -ac 1 -ar 16000 audio16k.wav
```
Parse `-progress pipe:1` (`out_time_ms`) to report % to UI.

### 4.2 Vocal separation
`python -m demucs --two-stems=vocals -n htdemucs -o stems full.wav` → `vocals.wav`, `no_vocals.wav` (= instrumental, shown as track A2 in the timeline). Use `--device cuda` when available.

### 4.3 Transcribe — engine options (dropdown on the Transcribe button)
1. **Direct (Gemini)** — upload audio via Gemini Files API; one call returns transcription + translation + speaker + gender. Use JSON response schema:
   ```json
   [{"start":12.34,"end":15.02,"speaker":"A1","gender":"male","original":"...","khmer":"..."}]
   ```
   For audio > 10 min, split into 5-min chunks on silence (ffmpeg `silencedetect`) with 2-second overlap, then de-duplicate by timestamp.
2. **Whisper + Translate** — faster-whisper (`large-v3` or `medium`), `vad_filter=True`, `word_timestamps=True`; then translate text only.
3. **Gemini Transcribe + Cast** — Gemini returns who speaks when (Actor 1, 2…) with gender, then translate.
4. **Offline Speakers + Translate** — whisper + local diarization + offline/selected translator. No internet needed.

Post-process: merge segments < 0.6 s into neighbours, split segments > 8 s at punctuation, clamp overlaps.

### 4.4 Diarization + gender (offline)
- Run pyannote (or sherpa-onnx embeddings + agglomerative clustering, threshold ~0.7).
- Assign each whisper segment to the speaker with the largest time overlap.
- Gender: median F0 from `librosa.pyin` over the speaker's vocals.wav regions. `F0 >= 165 Hz → female`, `< 155 → male`, otherwise unknown. Let the user override.
- Build Actor list: line count, total seconds, sample line.

### 4.5 Translation
- Chunk 60 lines per request. Include the 10 previous translated lines as context and the project glossary.
- System prompt:
  ```
  You are a professional Khmer dubbing translator for drama/film.
  Translate each line into natural, spoken Khmer that a voice actor can say aloud.
  Keep it short enough to be spoken in roughly the same time as the original.
  Keep character names consistent with the glossary. Keep tone (angry, polite, joking).
  Do not add explanations. Return ONLY JSON: [{"id":"...","khmer":"..."}] with exactly the same ids.
  Glossary: {glossary}
  ```
- Validate: same count and ids; if not, retry up to 3x, then split the chunk in half.
- Extract new proper nouns into glossary suggestions (user approves).
- API key pool: multiple keys, round-robin, mark a key "cooling" for 60 s on HTTP 429, show "Keys 8/8" status in the footer.
- Providers: Gemini (`@google/genai`), OpenRouter (OpenAI-compatible `baseURL=https://openrouter.ai/api/v1`, model chosen in settings), Offline (NLLB-200 distilled 600M via CTranslate2, `khm_Khmr`).

### 4.6 TTS
- **Edge-TTS**: Khmer voices `km-KH-PisethNeural` (male), `km-KH-SreymomNeural` (female); also list all voices from `edge-tts --list-voices` for other languages. Generate per segment with rate/pitch/volume. Run 4–6 concurrent requests, retry on failure.
- **Local clone engine**: Python FastAPI server `POST /tts {text, ref_audio, ref_text, speed}` → wav. User creates a voice by uploading 5–15 s reference audio + its transcript. Settings page shows GPU status and number of parallel GPU workers ("lanes").
- Default voices: "Default Male" and "Default Female". Cast panel "Auto-match" gives male actors distinct male voices and female actors distinct female voices (round-robin through available voices).
- Cache: hash(text+voice+speed+pitch) → reuse wav.

### 4.7 Auto-fit (most important for quality)
```
slot = seg.end - seg.start
if syncEnd: slot may extend into following silence up to nextSeg.start - 0.05
ratio = ttsDur / slot
if ratio <= 1.0: speed = 1.0 (pad silence)
elif ratio <= maxSpeed (default 1.6): speed = ratio → ffmpeg atempo (chain atempo for >2.0)
else: speed = maxSpeed, fitWarning = true (orange ▲ in grid), suggest: shorten text (button "AI shorten" asks LLM for a shorter Khmer line)
```
Prefer regenerating with the TTS engine's own rate parameter (sounds better than atempo); use atempo as fallback. Trim leading/trailing silence with `silenceremove` first.

### 4.8 Mix
- Build dub track in Python (numpy + soundfile) or pydub: empty array of video length at 44.1 kHz, place each clip at `start`, apply per-line volume.
- Ducking with ffmpeg:
  ```bash
  ffmpeg -i instrumental.wav -i dub.wav -filter_complex \
  "[1]asplit[sc][d];[0][sc]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[bg];\
   [bg][d]amix=inputs=2:normalize=0,alimiter=limit=0.95[out]" -map "[out]" mix.wav
  ```
- Option: keep original voices at low volume ("ORIG" track) instead of instrumental.
- Loudness normalize final to -14 LUFS (`loudnorm`).

### 4.9 Export
```bash
ffmpeg -i in.mp4 -i mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k out.mp4
# burn subtitles (needs Khmer font, e.g. Kantumruy Pro / Noto Sans Khmer)
ffmpeg -i in.mp4 -i mix.wav -vf "subtitles=km.srt:force_style='FontName=Kantumruy Pro,FontSize=22,Outline=2'" \
  -map 0:v -map 1:a -c:v h264_nvenc -c:a aac out_sub.mp4
```
Auto-detect GPU encoder (`h264_nvenc`, `h264_qsv`, `h264_amf`) with fallback to `libx264`.
Also export SRT, VTT, dub-only WAV, and the instrumental.

---

## 5. UI layout (match this workflow, your own design)

- **Top bar**: logo, app name, episode badge, open project, undo/redo, view toggles, theme (light/dark), language (km/en), settings.
- **Left panel**: video preview player (current time / duration, play, stop, subtitle toggle, volume) with the current Khmer subtitle overlaid; under it a grid of tool buttons: Import Video, Import BGM, Import AI Voice, Separate Vocals (Remove BGM), Mute Original, Export SRT, Import SRT/VTT, Burn Subtitles, Automate.
- **Center: Segment grid** (virtualized with `@tanstack/react-virtual` for 1000+ rows): checkbox, start, end, Khmer text (editable inline), actor badge (A1..An colored), voice dropdown, speed with −/+ and warning ▲, play-line button, actor button. Toolbar: Add line, Split, Delete, Find & Replace, Sort, Series/episode menu, Cast (n) popover, "Set voice to" Male/Female quick-apply for selected lines.
- **Cast popover**: list of actors with color number, name, gender chip, sample line, line count & seconds, voice dropdown; buttons Auto-match and Apply cast.
- **Bottom: Timeline** — zoom slider, tools (cut), global speed/pitch/volume sliders, Reverb toggle, tracks:
  `V1` video waveform · `ORIG` original audio · `T1` subtitle blocks · `A1` dub voice clips · `A2` instrumental/BGM.
  Playhead synced with player; click a block → selects grid row; drag block edges → edits start/end.
  Action row: target language, Auto-Fit (ON/OFF), Speed-fix count (e.g. "4 lines too fast"), Voices, Sync End, Ducking ON/OFF, Read Screen (OCR hard-coded subtitles via Gemini vision on sampled frames), **Transcribe** (engine dropdown), **Generate Selected Audio** (voice-engine dropdown).
- **Footer**: episode tabs E01…En (add/close), job/progress panel, API key pool status, disk/RAM usage.
- **Settings modal** (left nav + search Ctrl+F): General, Account, Theme, API Keys, Shortcuts, Voice Clone engine, Offline Voices, Pronunciation dictionary (word → replacement before TTS), Health, Tutorials, About (version + update).
- **Health page**: run checks with spinners → green ticks + score "14/14": backend, ffmpeg, ffprobe, GPU encoder, Python, edge-tts, whisper, demucs, diarization, clone engine, CUDA, API keys valid, disk space, internet.
- **Update modal**: shows current → new version and changelog from GitHub release notes; Download & Install / Maybe later.

Keyboard: Space play/pause, Ctrl+Z/Y, Ctrl+F find, ↑/↓ rows, Enter edit, Ctrl+Enter generate selected, Delete remove.

---

## 6. Automate (batch)
User picks episodes + preset (engine choices, voices, export options). Run per episode: separate → transcribe → diarize → translate → apply cast (reuse project cast by matching speaker embeddings across episodes) → TTS → fit → mix → export. Show per-episode progress, allow pause/resume, write a log file. Limit GPU jobs by "lanes" setting.

---

## 7. Non-functional rules
- Never block the UI; all heavy work is a job with progress and cancel.
- Every Python worker has `/health` and is started lazily, killed on app quit.
- All file paths support Unicode/Khmer characters and spaces (always pass args as arrays, never shell strings).
- Errors shown as toast + details in job log; retry button per failed segment.
- API keys stored only in OS keychain, never in project.json or logs.
- Write unit tests for `srt.ts`, `fit.ts`, chunking/validation in `translate.ts`.

---

## 8. Build phases (do in order, stop after each for me to test)

1. **Skeleton**: Electron + React + Tailwind + Fastify backend + ffmpeg bundled; open video, preview player, Health page (core checks).
2. **SRT + grid**: import/export SRT/VTT, virtualized editable grid, undo/redo, autosave project.
3. **Transcribe + translate**: faster-whisper worker, Gemini + OpenRouter translation with chunking, glossary, key pool.
4. **TTS + fit + mix + export**: Edge-TTS, auto-fit, dub track, MP4 export → **first full dub end-to-end**.
5. **Separation + ducking**: demucs instrumental, sidechain ducking, ORIG/A2 tracks.
6. **Timeline**: wavesurfer tracks, draggable blocks, playhead sync, zoom.
7. **Speakers + Cast**: diarization, gender, cast popover, auto-match.
8. **Gemini Direct + Read Screen (OCR)**.
9. **Voice cloning engine + GPU lanes + offline translation**.
10. **Multi-episode tabs, Automate batch, settings pages, i18n km/en, installer, auto-update**.

Start with Phase 1. Before writing code, show me the plan and the list of files you will create.
