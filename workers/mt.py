"""Offline translation with NLLB-200 distilled 600M (CTranslate2 int8)."""
import os

CT2_REPO = "JustFrederik/nllb-200-distilled-600M-ct2-int8"
SPM_REPO = "facebook/nllb-200-distilled-600M"

NLLB = {
    "km": "khm_Khmr", "en": "eng_Latn", "zh": "zho_Hans", "ko": "kor_Hang", "ja": "jpn_Jpan", "th": "tha_Thai",
    "vi": "vie_Latn", "id": "ind_Latn", "lo": "lao_Laoo", "fr": "fra_Latn", "es": "spa_Latn", "hi": "hin_Deva",
    "ru": "rus_Cyrl", "de": "deu_Latn", "pt": "por_Latn", "ar": "arb_Arab", "tl": "tgl_Latn", "ms": "zsm_Latn",
    "my": "mya_Mymr", "it": "ita_Latn", "tr": "tur_Latn",
}

_tr = None
_sp = None


def _load(job):
    global _tr, _sp
    if _tr is None:
        import ctranslate2
        import sentencepiece as spm
        from huggingface_hub import hf_hub_download, snapshot_download

        job.update(1, "Loading NLLB model (first run downloads ~650 MB)")
        cache = os.path.join(os.environ.get("KD_MODELS", "."), "nllb")
        model_dir = snapshot_download(CT2_REPO, cache_dir=cache)
        spm_file = os.path.join(model_dir, "sentencepiece.bpe.model")
        if not os.path.exists(spm_file):
            spm_file = hf_hub_download(SPM_REPO, "sentencepiece.bpe.model", cache_dir=cache)
        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        _tr = ctranslate2.Translator(model_dir, device=device, compute_type="int8_float16" if device == "cuda" else "int8")
        _sp = spm.SentencePieceProcessor(model_file=spm_file)
    return _tr, _sp


def translate(p, job):
    tr, sp = _load(job)
    src = NLLB.get((p.get("src") or "en").split("-")[0], "eng_Latn")
    if p.get("src") in (None, "", "auto"):
        src = "eng_Latn"
    tgt = NLLB.get(p.get("tgt") or "km", "khm_Khmr")
    items = p["items"]
    out = []
    B = 16
    for i in range(0, len(items), B):
        job.update(5 + 95 * i / max(1, len(items)), f"Translating {i + 1}/{len(items)} offline")
        batch = items[i : i + B]
        toks = [[src] + sp.encode(it["text"], out_type=str) + ["</s>"] for it in batch]
        res = tr.translate_batch(toks, target_prefix=[[tgt]] * len(batch), beam_size=4, max_decoding_length=256)
        for it, r in zip(batch, res):
            hyp = r.hypotheses[0]
            if hyp and hyp[0] == tgt:
                hyp = hyp[1:]
            out.append({"id": it["id"], "khmer": sp.decode(hyp).strip()})
    return {"results": out}
