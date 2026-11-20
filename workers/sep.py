"""Vocal separation with demucs (htdemucs, two-stems=vocals) run as a subprocess for progress + cancel."""
import os
import re
import shutil
import subprocess
import sys
import tempfile


def _cuda():
    try:
        import torch

        return torch.cuda.is_available()
    except Exception:  # noqa: BLE001
        return False


def separate(p, job):
    src = p["input"]
    device = p.get("device") or "auto"
    if device == "auto":
        device = "cuda" if _cuda() else "cpu"
    out = tempfile.mkdtemp(prefix="kd_demucs_")
    # copy to an ASCII path: demucs names its output folder after the input file
    tmp_in = os.path.join(out, "input.wav")
    shutil.copyfile(src, tmp_in)
    cmd = [sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", "htdemucs", "-o", out, "--device", device]
    if device == "cpu":
        # CPU: split the work across cores (each job holds a copy of the model, so cap it)
        cmd += ["-j", str(max(1, min(4, (os.cpu_count() or 2) // 2)))]
    cmd.append(tmp_in)
    job.update(1, f"Demucs on {device.upper()} (first run downloads the model)")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", bufsize=1)
    tail = []
    buf = ""
    try:
        while True:
            ch = proc.stdout.read(1)
            if not ch:
                break
            if ch in "\r\n":
                line = buf.strip()
                buf = ""
                if line:
                    tail = (tail + [line])[-8:]
                    m = re.search(r"(\d+(?:\.\d+)?)%\|", line)
                    if m:
                        job.update(float(m.group(1)), "Separating vocals")
                if job.canceled:
                    proc.kill()
                    job.check()
            else:
                buf += ch
        code = proc.wait()
        if code != 0:
            raise RuntimeError("demucs failed: " + " | ".join(tail[-3:]))
        stem_dir = os.path.join(out, "htdemucs", "input")
        shutil.move(os.path.join(stem_dir, "vocals.wav"), p["vocals"])
        shutil.move(os.path.join(stem_dir, "no_vocals.wav"), p["instrumental"])
        return {"vocals": p["vocals"], "instrumental": p["instrumental"], "device": device}
    finally:
        if proc.poll() is None:
            proc.kill()
        shutil.rmtree(out, ignore_errors=True)
