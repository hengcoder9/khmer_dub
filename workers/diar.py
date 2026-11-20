"""Offline speaker diarization at line level + pitch-based gender.

Each transcript line gets a voice embedding (Resemblyzer, weights ship with the package);
lines are clustered with agglomerative clustering on cosine distance. Gender per speaker
from the median F0 (librosa.pyin) of that speaker's lines: >=165 Hz female, <155 Hz male.
"""
import numpy as np

SR = 16000
_encoder = None


def _load_audio(path):
    import soundfile as sf

    wav, sr = sf.read(path, dtype="float32", always_2d=False)
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    if sr != SR:
        import librosa

        wav = librosa.resample(wav, orig_sr=sr, target_sr=SR)
    return wav


def _enc():
    global _encoder
    if _encoder is None:
        import torch
        from resemblyzer import VoiceEncoder

        _encoder = VoiceEncoder(device="cuda" if torch.cuda.is_available() else "cpu", verbose=False)
    return _encoder


def _gender(f0):
    if f0 is None or not np.isfinite(f0):
        return "unknown"
    if f0 >= 165:
        return "female"
    if f0 < 155:
        return "male"
    return "unknown"


def diarize(p, job):
    from sklearn.cluster import AgglomerativeClustering

    job.update(1, "Loading audio")
    wav = _load_audio(p["audio"])
    pitch_wav = wav if p.get("pitch_audio") in (None, p["audio"]) else _load_audio(p["pitch_audio"])
    segs = p["segments"]
    enc = _enc()

    embs, ids = [], []
    short = []
    for i, s in enumerate(segs):
        job.update(5 + 60 * i / max(1, len(segs)), f"Voice embeddings {i + 1}/{len(segs)}")
        a, b = int(s["start"] * SR), int(s["end"] * SR)
        chunk = wav[a:b]
        if len(chunk) < SR * 0.7:  # too short for a reliable embedding
            short.append(s)
            continue
        embs.append(enc.embed_utterance(chunk))
        ids.append(s["id"])

    if not embs:
        return {"assign": {s["id"]: "S0" for s in segs}, "speakers": [{"id": "S0", "gender": "unknown", "f0": 0, "embedding": []}]}

    X = np.vstack(embs)
    job.update(68, "Clustering speakers")
    if len(X) == 1:
        labels = np.array([0])
    else:
        n = p.get("num_speakers")
        if n:
            cl = AgglomerativeClustering(n_clusters=int(n), metric="cosine", linkage="average")
        else:
            cl = AgglomerativeClustering(n_clusters=None, metric="cosine", linkage="average", distance_threshold=1 - float(p.get("threshold", 0.7)))
        labels = cl.fit_predict(X)

    # order speakers by amount of speech so S0 is the main character
    totals = {}
    for sid, lab in zip(ids, labels):
        s = next(x for x in segs if x["id"] == sid)
        totals[lab] = totals.get(lab, 0) + s["end"] - s["start"]
    order = {lab: f"S{i}" for i, lab in enumerate(sorted(totals, key=lambda k: -totals[k]))}
    assign = {sid: order[lab] for sid, lab in zip(ids, labels)}

    centroids = {}
    for lab, name in order.items():
        c = X[labels == lab].mean(axis=0)
        centroids[name] = c / (np.linalg.norm(c) + 1e-9)

    # short lines: nearest neighbour in time
    for s in short:
        best, dist = None, 1e9
        for o in segs:
            if o["id"] in assign:
                d = min(abs(o["start"] - s["end"]), abs(s["start"] - o["end"]))
                if d < dist:
                    best, dist = o["id"], d
        assign[s["id"]] = assign.get(best, "S0")

    # gender from pitch
    import librosa

    speakers = []
    names = list(centroids)
    for k, name in enumerate(names):
        job.update(75 + 25 * k / max(1, len(names)), f"Estimating gender {k + 1}/{len(names)}")
        parts, total = [], 0.0
        for s in segs:
            if assign.get(s["id"]) == name and total < 30:
                a, b = int(s["start"] * SR), int(s["end"] * SR)
                parts.append(pitch_wav[a:b])
                total += s["end"] - s["start"]
        f0m = float("nan")
        if parts:
            y = np.concatenate(parts)
            f0, voiced, _ = librosa.pyin(y, fmin=60, fmax=400, sr=SR, frame_length=1024)
            v = f0[voiced & np.isfinite(f0)] if f0 is not None else np.array([])
            if len(v):
                f0m = float(np.median(v))
        speakers.append({"id": name, "gender": _gender(f0m), "f0": round(f0m, 1) if np.isfinite(f0m) else 0, "embedding": [round(float(x), 5) for x in centroids[name]]})

    return {"assign": assign, "speakers": speakers}
