#!/usr/bin/env python3
"""
SMaLL-100 local translation daemon for nostr-paper PWA.

SMaLL-100 (alirezamsh/small100) covers 100+ languages with a single ~300 MB
multilingual model — ideal for a local-first social app.

Quick start (CPU):
    pip install fastapi uvicorn torch transformers sentencepiece accelerate
    python server/translate.py

GPU (CUDA):
    python server/translate.py --device cuda

Docker (CPU):
    docker build -f server/Dockerfile -t nostr-paper-translate .
    docker run --rm -p 7080:7080 nostr-paper-translate

Environment variables:
    TRANSLATE_PORT   listen port (default 7080)
    TRANSLATE_HOST   bind address (default 127.0.0.1)
    TRANSLATE_DEVICE cpu | cuda | mps (default: auto-detect)
"""

import argparse
import logging
import os
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

MODEL_ID = "alirezamsh/small100"

# ISO 639-1 subset supported by SMaLL-100 (FLORES-200 superset).
# Clients send 2-letter codes; the tokenizer handles the mapping internally.
SUPPORTED_LANGUAGES: dict[str, str] = {
    "af": "Afrikaans", "am": "Amharic", "ar": "Arabic", "az": "Azerbaijani",
    "be": "Belarusian", "bg": "Bulgarian", "bn": "Bengali", "bs": "Bosnian",
    "ca": "Catalan", "cs": "Czech", "cy": "Welsh", "da": "Danish",
    "de": "German", "el": "Greek", "en": "English", "es": "Spanish",
    "et": "Estonian", "fa": "Persian", "fi": "Finnish", "fr": "French",
    "ga": "Irish", "gl": "Galician", "gu": "Gujarati", "ha": "Hausa",
    "he": "Hebrew", "hi": "Hindi", "hr": "Croatian", "hu": "Hungarian",
    "hy": "Armenian", "id": "Indonesian", "is": "Icelandic", "it": "Italian",
    "ja": "Japanese", "ka": "Georgian", "kk": "Kazakh", "km": "Khmer",
    "kn": "Kannada", "ko": "Korean", "lo": "Lao", "lt": "Lithuanian",
    "lv": "Latvian", "mk": "Macedonian", "ml": "Malayalam", "mn": "Mongolian",
    "mr": "Marathi", "ms": "Malay", "my": "Burmese", "ne": "Nepali",
    "nl": "Dutch", "no": "Norwegian", "or": "Odia", "pa": "Punjabi",
    "pl": "Polish", "ps": "Pashto", "pt": "Portuguese", "ro": "Romanian",
    "ru": "Russian", "si": "Sinhala", "sk": "Slovak", "sl": "Slovenian",
    "so": "Somali", "sq": "Albanian", "sr": "Serbian", "sv": "Swedish",
    "sw": "Swahili", "ta": "Tamil", "th": "Thai", "tl": "Filipino",
    "tr": "Turkish", "uk": "Ukrainian", "ur": "Urdu", "uz": "Uzbek",
    "vi": "Vietnamese", "xh": "Xhosa", "yo": "Yoruba", "zh": "Chinese",
    "zu": "Zulu",
}

_tokenizer = None
_model = None
_device = "cpu"


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    global _tokenizer, _model, _device
    _device = os.environ.get("TRANSLATE_DEVICE") or (
        "cuda" if torch.cuda.is_available() else
        "mps" if torch.backends.mps.is_available() else
        "cpu"
    )
    log.info("Loading %s on %s …", MODEL_ID, _device)
    _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    _model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID).to(_device)
    _model.eval()
    log.info("Ready.")
    yield
    del _model, _tokenizer


app = FastAPI(lifespan=lifespan)

# Allow requests from any PWA origin (the model only receives text the user
# explicitly chooses to translate — no tokens or private data).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Accept"],
    max_age=3600,
)


class TranslateRequest(BaseModel):
    text: str
    source_lang: str = "auto"
    target_lang: str

    @field_validator("text")
    @classmethod
    def _validate_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text must not be empty")
        if len(v) > 10_000:
            raise ValueError("text exceeds 10 000 character limit")
        return v

    @field_validator("source_lang", "target_lang")
    @classmethod
    def _validate_lang(cls, v: str) -> str:
        code = v.strip().lower()
        if code not in ("auto", *SUPPORTED_LANGUAGES):
            raise ValueError(f"unsupported language code: {code!r}")
        return code


@app.get("/health")
def health():
    return {"status": "ok", "model": "small100", "device": _device}


@app.get("/languages")
def languages():
    return [
        {"code": code, "name": name}
        for code, name in sorted(SUPPORTED_LANGUAGES.items(), key=lambda x: x[1])
    ]


@app.post("/translate")
def translate(req: TranslateRequest):
    if _tokenizer is None or _model is None:
        raise HTTPException(503, "Model not loaded yet — retry in a moment")

    tgt = req.target_lang
    src = req.source_lang

    try:
        # SMaLL-100 uses forced target-language token as BOS
        _tokenizer.set_tgt_lang_special_tokens(tgt)
        inputs = _tokenizer(
            req.text,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=512,
        ).to(_device)

        with torch.no_grad():
            generated = _model.generate(
                **inputs,
                forced_bos_token_id=_tokenizer.get_lang_id(tgt),
                max_new_tokens=512,
                num_beams=4,
            )

        translation = _tokenizer.batch_decode(generated, skip_special_tokens=True)[0]
    except Exception as exc:  # noqa: BLE001
        log.exception("Translation failed")
        raise HTTPException(500, f"Translation error: {exc}") from exc

    return {
        "translation": translation.strip(),
        "detected_source_lang": None if src == "auto" else src,
    }


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="SMaLL-100 translation daemon")
    parser.add_argument("--host", default=os.environ.get("TRANSLATE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("TRANSLATE_PORT", "7080")))
    args = parser.parse_args()

    log.info("Listening on http://%s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
