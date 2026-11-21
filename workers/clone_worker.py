"""Local voice-cloning server (one process per GPU "lane").

POST /tts {text, ref_audio, ref_text, speed, out} -> writes a WAV to `out`.

Engines (--engine):
  voxcpm2  VoxCPM2 (OpenBMB, Apache-2.0): 30 languages including Khmer, cloned from the reference clip.
           Reference-only cloning, so an actor's voice can speak another language than the clip.
  f5       F5-TTS (English/Chinese base model; a Khmer fine-tuned checkpoint can be given with --ckpt/--vocab).
"""
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn  # noqa: E402
from fastapi import HTTPException, Request  # noqa: E402

from common import add_cuda_dll_dirs, arg, create_app, parse_port, watch_parent  # noqa: E402

add_cuda_dll_dirs()

ENGINE = (arg(sys.argv, "--engine", "f5") or "f5").lower()
MODEL = arg(sys.argv, "--model", "") or ("openbmb/VoxCPM2" if ENGINE == "voxcpm2" else "F5TTS_v1_Base")
CKPT = arg(sys.argv, "--ckpt", "") or ""
VOCAB = arg(sys.argv, "--vocab", "") or ""

app = create_app({})
_engine = None
_lock = threading.Lock()


def engine():
    global _engine
    if _engine is None:
        if ENGINE == "voxcpm2":
            try:
                from voxcpm import VoxCPM
            except ImportError as e:
                raise RuntimeError("VoxCPM2 is not installed. Install it in Settings → Engines → Voice cloning (VoxCPM2).") from e
            path = MODEL
            if not os.path.isdir(path):
                # download into a plain folder: the default Hugging Face cache uses symlinks, which fail on Windows
                # without Developer Mode / admin rights (WinError 1314)
                from huggingface_hub import snapshot_download

                path = os.path.join(os.environ.get("KD_MODELS") or os.path.expanduser("~/.khmerdub-models"), MODEL.split("/")[-1].lower())
                snapshot_download(repo_id=MODEL, local_dir=path)
            # no denoiser (needs modelscope) and no torch.compile (needs triton, not on Windows)
            _engine = VoxCPM.from_pretrained(path, load_denoiser=False, optimize=False)
        else:
            from f5_tts.api import F5TTS

            _engine = F5TTS(model=MODEL, ckpt_file=CKPT, vocab_file=VOCAB)
    return _engine


def split_sentences(text, max_chars=60):
    """Khmer/Latin sentence ends (។ ៕ ! ? .); VoxCPM2 drops words more often in long multi-sentence lines."""
    import re

    parts = [p.strip() for p in re.split(r"(?<=[។៕!?！？.])\s*", text) if p.strip()]
    out = []
    for p in parts:
        # merge tiny pieces ("ណា៎។") into the previous one so prosody stays natural
        if out and (len(p) < 8 or len(out[-1]) + len(p) <= max_chars // 2):
            out[-1] = out[-1] + " " + p
        else:
            out.append(p)
    return out or [text]


KHMER_CHARS_PER_SEC = 15.0  # measured from Edge's Khmer voices
MAX_TAKES = 3


def speech_seconds(w, sr):
    """Length without leading/trailing silence."""
    import numpy as np

    a = np.abs(w)
    if not a.size or a.max() <= 0:
        return 0.0
    idx = np.nonzero(a > a.max() * 0.03)[0]
    return (idx[-1] - idx[0]) / sr if idx.size else 0.0


def best_take(eng, sentence, ref_audio, sr):
    """VoxCPM2 sometimes skips words in Khmer: when a take is much shorter than the text needs, try again
    (up to MAX_TAKES) and keep the most complete one."""
    import numpy as np

    khmer = sum(1 for ch in sentence if "ក" <= ch <= "៿")
    expected = khmer / KHMER_CHARS_PER_SEC if khmer >= max(4, len(sentence) // 2) else 0.0
    best, best_len = None, -1.0
    for _ in range(MAX_TAKES if expected else 1):
        w = np.asarray(
            eng.generate(text=sentence, reference_wav_path=ref_audio, cfg_value=2.0, inference_timesteps=10, retry_badcase=True),
            dtype=np.float32,
        ).reshape(-1)
        n = speech_seconds(w, sr)
        if n > best_len:
            best, best_len = w, n
        if not expected or n >= expected * 0.8:
            break
    return best


def voxcpm_tts(text, ref_audio, speed, out):
    import numpy as np
    import soundfile as sf

    eng = engine()
    sr = int(eng.tts_model.sample_rate)
    pieces = []
    for i, sentence in enumerate(split_sentences(text)):
        w = best_take(eng, sentence, ref_audio, sr)
        if i:
            pieces.append(np.zeros(int(sr * 0.18), dtype=np.float32))  # short breath between sentences
        pieces.append(w)
    wav = np.concatenate(pieces) if pieces else np.zeros(1, dtype=np.float32)
    if abs(speed - 1.0) > 0.02:
        import librosa

        wav = librosa.effects.time_stretch(wav, rate=max(0.5, min(2.0, speed)))
    peak = float(np.max(np.abs(wav))) if wav.size else 0.0
    if peak > 0.99:
        wav = wav / peak * 0.98
    sf.write(out, wav, sr, subtype="PCM_16")


@app.get("/health")
def health():
    info = {"ok": True, "engine": ENGINE, "model": MODEL, "custom_ckpt": bool(CKPT)}
    try:
        import torch

        info["gpu"] = torch.cuda.is_available()
        if info["gpu"]:
            info["device"] = torch.cuda.get_device_name(0)
            info["vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
    except Exception:  # noqa: BLE001
        info["gpu"] = False
    if ENGINE == "voxcpm2":
        try:
            import voxcpm  # noqa: F401

            info["installed"] = True
        except ImportError:
            info["installed"] = False
    return info


@app.post("/warmup")
def warmup():
    """Load the model now (first load downloads ~5 GB for VoxCPM2)."""
    with _lock:
        engine()
    return {"ok": True}


@app.post("/tts")
async def tts(request: Request):
    p = await request.json()
    text = (p.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "empty text")
    out = p["out"]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    part = out + ".part.wav"
    try:
        with _lock:  # one generation at a time per lane
            if ENGINE == "voxcpm2":
                voxcpm_tts(text, p["ref_audio"], float(p.get("speed", 1.0)), part)
            else:
                engine().infer(
                    ref_file=p["ref_audio"],
                    ref_text=p.get("ref_text", ""),
                    gen_text=text,
                    file_wave=part,
                    speed=float(p.get("speed", 1.0)),
                    remove_silence=True,
                )
        os.replace(part, out)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"{type(e).__name__}: {e}") from e
    return {"ok": True, "out": out}


if __name__ == "__main__":
    watch_parent()
    uvicorn.run(app, host="127.0.0.1", port=parse_port(sys.argv), log_level="warning")
