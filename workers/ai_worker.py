"""Main AI worker: STT (faster-whisper), separation (demucs), diarization + gender,
Edge-TTS batches and offline translation (NLLB). Heavy modules are imported lazily."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # embedded Python ignores the script dir

import importlib.util  # noqa: E402

import uvicorn  # noqa: E402

from common import add_cuda_dll_dirs, create_app, parse_port, watch_parent  # noqa: E402

add_cuda_dll_dirs()


def _stt(p, job):
    from stt import transcribe

    return transcribe(p, job)


def _separate(p, job):
    from sep import separate

    return separate(p, job)


def _diarize(p, job):
    from diar import diarize

    return diarize(p, job)


def _tts_edge(p, job):
    from tts_edge import synth_batch

    return synth_batch(p, job)


def _mt(p, job):
    from mt import translate

    return translate(p, job)


def _ocr(p, job):
    from ocr import read

    return read(p, job)


app = create_app({"stt": _stt, "separate": _separate, "diarize": _diarize, "tts_edge": _tts_edge, "mt": _mt, "ocr": _ocr})


@app.get("/health")
def health():
    return {"ok": True, "python": sys.version.split()[0], "pid": os.getpid()}


@app.get("/deps")
def deps():
    mods = ["edge_tts", "faster_whisper", "torch", "demucs", "resemblyzer", "librosa", "sklearn", "ctranslate2", "f5_tts", "rapidocr_onnxruntime"]
    return {m: importlib.util.find_spec(m) is not None for m in mods}


@app.get("/cuda")
def cuda():
    info = {}
    try:
        import torch

        info["torch"] = bool(torch.cuda.is_available())
        if info["torch"]:
            info["device"] = torch.cuda.get_device_name(0)
    except Exception:  # noqa: BLE001
        info["torch"] = False
    try:
        import ctranslate2

        info["ctranslate2"] = ctranslate2.get_cuda_device_count()
    except Exception:  # noqa: BLE001
        info["ctranslate2"] = 0
    return info


@app.get("/voices/edge")
def edge_voices():
    import asyncio

    import edge_tts

    return {"voices": asyncio.run(edge_tts.list_voices())}


if __name__ == "__main__":
    watch_parent()
    uvicorn.run(app, host="127.0.0.1", port=parse_port(sys.argv), log_level="warning")
