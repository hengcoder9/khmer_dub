"""Shared worker plumbing: token auth, background jobs with progress/cancel, parent watchdog."""
import os
import sys
import threading
import time
import traceback
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

TOKEN = os.environ.get("KD_TOKEN", "")


class Canceled(Exception):
    pass


class Job:
    def __init__(self, kind):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.status = "running"
        self.progress = 0.0
        self.message = ""
        self.result = None
        self.error = None
        self.canceled = False
        self.finished_at = None

    def update(self, progress=None, message=None):
        if self.canceled:
            raise Canceled()
        if progress is not None:
            self.progress = max(0.0, min(100.0, float(progress)))
        if message is not None:
            self.message = message

    def check(self):
        if self.canceled:
            raise Canceled()

    def as_dict(self):
        return {
            "id": self.id,
            "status": self.status,
            "progress": round(self.progress, 1),
            "message": self.message,
            "result": self.result if self.status == "done" else None,
            "error": self.error,
        }


JOBS = {}
_lock = threading.Lock()


def start_job(kind, fn, payload):
    job = Job(kind)
    with _lock:
        JOBS[job.id] = job
        # forget finished jobs after 10 minutes
        now = time.time()
        for k in [k for k, j in JOBS.items() if j.finished_at and now - j.finished_at > 600]:
            JOBS.pop(k, None)

    def runner():
        try:
            job.result = fn(payload, job)
            job.status = "canceled" if job.canceled else "done"
            job.progress = 100.0
        except Canceled:
            job.status = "canceled"
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            job.status = "error"
            job.error = f"{type(e).__name__}: {e}"
        finally:
            job.finished_at = time.time()

    threading.Thread(target=runner, daemon=True).start()
    return job


def create_app(job_kinds):
    """job_kinds: dict kind -> fn(payload, job) -> result"""
    app = FastAPI()

    @app.middleware("http")
    async def auth(request: Request, call_next):
        if request.headers.get("x-kd-token") != TOKEN:
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        return await call_next(request)

    @app.post("/jobs/{kind}")
    async def create(kind: str, request: Request):
        fn = job_kinds.get(kind)
        if not fn:
            raise HTTPException(404, f"unknown job kind {kind}")
        payload = await request.json()
        return {"id": start_job(kind, fn, payload).id}

    @app.get("/jobs/{job_id}")
    def get(job_id: str):
        job = JOBS.get(job_id)
        if not job:
            raise HTTPException(404, "unknown job")
        return job.as_dict()

    @app.post("/jobs/{job_id}/cancel")
    def cancel(job_id: str):
        job = JOBS.get(job_id)
        if job:
            job.canceled = True
        return {"ok": bool(job)}

    return app


def watch_parent():
    """Exit when the Node backend that started us disappears (avoids orphan GPU processes)."""
    pid = int(os.environ.get("KD_PARENT_PID", "0") or 0)
    if not pid:
        return

    def alive(p):
        if sys.platform == "win32":
            import ctypes

            k32 = ctypes.windll.kernel32
            h = k32.OpenProcess(0x1000, False, p)  # PROCESS_QUERY_LIMITED_INFORMATION
            if not h:
                return False
            code = ctypes.c_ulong()
            k32.GetExitCodeProcess(h, ctypes.byref(code))
            k32.CloseHandle(h)
            return code.value == 259  # STILL_ACTIVE
        try:
            os.kill(p, 0)
            return True
        except OSError:
            return False

    def loop():
        while True:
            time.sleep(3)
            if not alive(pid):
                os._exit(0)

    threading.Thread(target=loop, daemon=True).start()


def add_cuda_dll_dirs():
    """pip-installed NVIDIA libs (cublas/cudnn) live in site-packages/nvidia/*/bin on Windows."""
    if sys.platform != "win32":
        return
    for base in sys.path:
        nv = os.path.join(base, "nvidia")
        if os.path.isdir(nv):
            for d in os.listdir(nv):
                b = os.path.join(nv, d, "bin")
                if os.path.isdir(b):
                    try:
                        os.add_dll_directory(b)
                    except OSError:
                        pass
                    os.environ["PATH"] = b + os.pathsep + os.environ.get("PATH", "")


def parse_port(argv):
    for i, a in enumerate(argv):
        if a == "--port" and i + 1 < len(argv):
            return int(argv[i + 1])
    return 0


def arg(argv, name, default=None):
    for i, a in enumerate(argv):
        if a == name and i + 1 < len(argv):
            return argv[i + 1]
    return default
