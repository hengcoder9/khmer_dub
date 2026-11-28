"""Offline screen reader: RapidOCR (PaddleOCR models on ONNX Runtime, CPU). Reads Chinese and English.

Job "ocr": {"images": [path, ...]} -> {"results": [{"text": str, "lines": [{"text", "score", "box": [x0, y0, x1, y1]}]}]}
Boxes are fractions 0..1 of the image (for "Find it for me"); text is the lines top-to-bottom, joined by spaces.
"""
_engine = None


def _get():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _engine = RapidOCR()
    return _engine


def _imread(path):
    import cv2
    import numpy as np

    # np.fromfile + imdecode: cv2.imread can't open Unicode (e.g. Khmer) paths on Windows
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def order_lines(result, w, h, min_score=0.5):
    """RapidOCR boxes -> (text in reading order, lines with 0..1 boxes). Pure: no OCR packages needed."""
    lines = []
    for box, text, score in result:
        if float(score) < min_score or not str(text).strip():
            continue
        xs = [pt[0] for pt in box]
        ys = [pt[1] for pt in box]
        lines.append({"text": str(text).strip(), "score": round(float(score), 3), "box": [min(xs) / w, min(ys) / h, max(xs) / w, max(ys) / h]})
    # reading order: rows top to bottom (a row = boxes whose centres are close), left to right inside a row
    lines.sort(key=lambda l: ((l["box"][1] + l["box"][3]) / 2, l["box"][0]))
    rows = []
    for l in lines:
        cy = (l["box"][1] + l["box"][3]) / 2
        if rows and abs(rows[-1]["cy"] - cy) < 0.04:
            rows[-1]["items"].append(l)
        else:
            rows.append({"cy": cy, "items": [l]})
    text = " ".join(" ".join(x["text"] for x in sorted(r["items"], key=lambda l: l["box"][0])) for r in rows)
    return text, lines


def read(p, job):
    eng = _get()
    images = p.get("images") or []
    min_score = float(p.get("min_score", 0.5))
    out = []
    for i, path in enumerate(images):
        img = _imread(path)
        if img is None:
            out.append({"text": "", "lines": []})
            continue
        h, w = img.shape[:2]
        result, _ = eng(img)
        text, lines = order_lines(result or [], w, h, min_score)
        out.append({"text": text, "lines": lines})
        if job is not None and (i % 4 == 0 or i == len(images) - 1):
            job.update(100 * (i + 1) / max(1, len(images)), f"Read {i + 1} of {len(images)} frames (offline)")
    return {"results": out}
