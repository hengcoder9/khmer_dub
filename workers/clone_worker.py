"""Local voice-cloning server (one process per GPU "lane").

POST /tts {text, ref_audio, ref_text, speed, out} -> writes a WAV to `out`.
Default engine: F5-TTS. A Khmer fine-tuned checkpoint can be supplied with --ckpt/--vocab
(the base F5-TTS model speaks English/Chinese only).
"""
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn  # noqa: E402
from fastapi import HTTPException, Request  # noqa: E402

from common import add_cuda_dll_dirs, arg, create_app, parse_port, watch_parent  # noqa: E402

add_cuda_dll_dirs()

MODEL = arg(sys.argv, "--model", "F5TTS_v1_Base")
CKPT = arg(sys.argv, "--ckpt", "") or ""
VOCAB = arg(sys.argv, "--vocab", "") or ""

app = create_app({})
_engine = None
_lock = threading.Lock()


def engine():
    global _engine
    if _engine is None:
        from f5_tts.api import F5TTS

        _engine = F5TTS(model=MODEL, ckpt_file=CKPT, vocab_file=VOCAB)
    return _engine


@app.get("/health")
def health():
    info = {"ok": True, "model": MODEL, "custom_ckpt": bool(CKPT)}
    try:
        import torch

        info["gpu"] = torch.cuda.is_available()
        if info["gpu"]:
            info["device"] = torch.cuda.get_device_name(0)
    except Exception:  # noqa: BLE001
        info["gpu"] = False
    return info


@app.post("/tts")
async def tts(request: Request):
    p = await request.json()
    text = (p.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "empty text")
    out = p["out"]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    try:
        with _lock:  # one generation at a time per lane
            engine().infer(
                ref_file=p["ref_audio"],
                ref_text=p.get("ref_text", ""),
                gen_text=text,
                file_wave=out + ".part.wav",
                speed=float(p.get("speed", 1.0)),
                remove_silence=True,
            )
        os.replace(out + ".part.wav", out)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"{type(e).__name__}: {e}") from e
    return {"ok": True, "out": out}


if __name__ == "__main__":
    watch_parent()
    uvicorn.run(app, host="127.0.0.1", port=parse_port(sys.argv), log_level="warning")
