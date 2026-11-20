"""faster-whisper transcription with VAD and word timestamps."""
import os
import threading
import time

_model = None
_model_key = None


def _device():
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:  # noqa: BLE001
        pass
    return "cpu", "int8"


def _dir_mb(path):
    total = 0
    for dirpath, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(dirpath, f))
            except OSError:
                pass
    return total / 1048576


def _watch_download(root, name, device, job, stop):
    """Report MB downloaded and speed while the model loads, so a slow first download doesn't look frozen."""
    start = last = _dir_mb(root)
    t0 = time.time()
    while not stop.wait(2):
        now = _dir_mb(root)
        if now - start < 1:
            continue  # nothing downloading (model already cached, just loading)
        speed = (now - last) / 2
        last = now
        job.update(2, f"Downloading Whisper {name}: {now - start:.0f} MB ({speed:.1f} MB/s, {time.time() - t0:.0f} s)")


def _load(name, job):
    global _model, _model_key
    device, compute = _device()
    key = (name, device)
    if _model is None or _model_key != key:
        from faster_whisper import WhisperModel

        job.update(2, f"Loading Whisper {name} on {device.upper()} (first run downloads the model)")
        root = os.path.join(os.environ.get("KD_MODELS", "."), "whisper")
        stop = threading.Event()
        threading.Thread(target=_watch_download, args=(root, name, device, job, stop), daemon=True).start()
        try:
            _model = WhisperModel(name, device=device, compute_type=compute, download_root=root)
        except Exception:  # noqa: BLE001  CUDA libs missing → CPU fallback
            if device == "cpu":
                raise
            _model = WhisperModel(name, device="cpu", compute_type="int8", download_root=root)
            device = "cpu"
        finally:
            stop.set()
        _model_key = (name, device)
    return _model


def transcribe(p, job):
    model = _load(p.get("model") or "large-v3-turbo", job)
    args = dict(
        language=p.get("language") or None,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        word_timestamps=True,
        beam_size=5,
        condition_on_previous_text=False,
    )
    segments = info = None
    if _model_key and _model_key[1] == "cuda":
        # GPU: batched inference decodes many VAD chunks at once (several times faster)
        try:
            from faster_whisper import BatchedInferencePipeline

            segments, info = BatchedInferencePipeline(model=model).transcribe(p["audio"], batch_size=12, **args)
        except Exception as e:  # noqa: BLE001  older faster-whisper / OOM → normal path
            print(f"batched whisper unavailable, using sequential: {e}", flush=True)
            segments = None
    if segments is None:
        segments, info = model.transcribe(p["audio"], **args)
    duration = max(1.0, float(getattr(info, "duration", 0) or 1.0))
    out = []
    for s in segments:  # generator: transcription happens while iterating
        job.update(5 + 95 * min(1.0, s.end / duration), f"Transcribing {s.end:.0f}/{duration:.0f} s")
        words = [{"start": round(w.start, 2), "end": round(w.end, 2), "text": w.word} for w in (s.words or [])]
        out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(), "words": words})
    return {"language": info.language, "segments": out}
