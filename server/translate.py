#!/usr/bin/env python3
"""
SMaLL-100 local translation daemon for nostr-paper PWA.

SMaLL-100 (alirezamsh/small100) offers faster startup and lower memory usage
for local-first translation workflows.

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
    TRANSLATE_MODEL_ID huggingface model id (default alirezamsh/small100)
"""

import argparse
import ipaddress
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

try:
    import torch
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
    _HAS_TRANSLATION_DEPS = True
except Exception:  # noqa: BLE001
    torch = None
    AutoTokenizer = None
    AutoModelForSeq2SeqLM = None
    _HAS_TRANSLATION_DEPS = False

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

MODEL_ID = os.environ.get("TRANSLATE_MODEL_ID", "alirezamsh/small100")
SAFE_BROWSING_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find"
SAFE_BROWSING_TIMEOUT_SECONDS = 8

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


def _normalize_text_for_compare(value: str) -> str:
    return " ".join(value.strip().casefold().split())


def _looks_unusable_translation(source_text: str, translated_text: str) -> bool:
    translated = translated_text.strip()
    if not translated:
        return True

    normalized_source = _normalize_text_for_compare(source_text)
    normalized_translated = _normalize_text_for_compare(translated)
    if normalized_source and normalized_source == normalized_translated:
        return True

    # Very short outputs from longer inputs are often special-token artifacts.
    if len(source_text.strip()) >= 12 and len(translated) <= 2:
        return True

    return False


def _is_public_http_url(value: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(value)
    except Exception:  # noqa: BLE001
        return False

    if parsed.scheme not in ("http", "https"):
        return False

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        return False

    if hostname in ("localhost", "127.0.0.1", "::1"):
        return False

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        return True

    return not (
        ip.is_private or
        ip.is_loopback or
        ip.is_link_local or
        ip.is_multicast or
        ip.is_reserved or
        ip.is_unspecified
    )


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    global _tokenizer, _model, _device
    if not _HAS_TRANSLATION_DEPS:
        log.warning("Translation dependencies are not installed; /translate endpoints will return 503.")
        _device = "unavailable"
        _tokenizer = None
        _model = None
        yield
        return

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


class SafeBrowsingCheckRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        value = v.strip()
        if not value:
            raise ValueError("url must not be empty")
        if len(value) > 2_048:
            raise ValueError("url exceeds 2048 character limit")
        if not _is_public_http_url(value):
            raise ValueError("url must be a public http(s) URL")
        return value


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID, "device": _device}


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
        if src != "auto" and hasattr(_tokenizer, "src_lang"):
            _tokenizer.src_lang = src

        # M2M100 generation path for multilingual translation.
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
        if _looks_unusable_translation(req.text, translation):
            # Retry once with explicit target prefix to avoid occasional token-only outputs.
            fallback_inputs = _tokenizer(
                f"__{tgt}__ {req.text}",
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=512,
            ).to(_device)
            with torch.no_grad():
                fallback_generated = _model.generate(
                    **fallback_inputs,
                    max_new_tokens=512,
                    num_beams=4,
                )
            translation = _tokenizer.batch_decode(fallback_generated, skip_special_tokens=True)[0]
    except Exception as exc:  # noqa: BLE001
        log.exception("Translation failed")
        raise HTTPException(500, f"Translation error: {exc}") from exc

    return {
        "translation": translation.strip(),
        "detected_source_lang": None if src == "auto" else src,
    }


@app.post("/safe-browsing/check")
def safe_browsing_check(req: SafeBrowsingCheckRequest):
    api_key = os.environ.get("GOOGLE_SAFE_BROWSING_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "Safe Browsing API key is not configured")

    upstream_url = f"{SAFE_BROWSING_ENDPOINT}?key={urllib.parse.quote_plus(api_key)}"
    payload = {
        "client": {
            "clientId": "nostr-paper",
            "clientVersion": "0.1.0",
        },
        "threatInfo": {
            "threatTypes": [
                "MALWARE",
                "SOCIAL_ENGINEERING",
                "UNWANTED_SOFTWARE",
                "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{"url": req.url}],
        },
    }

    request = urllib.request.Request(
        upstream_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=SAFE_BROWSING_TIMEOUT_SECONDS) as response:
            body = response.read(256_000)
            parsed = json.loads(body.decode("utf-8")) if body else {}
    except urllib.error.HTTPError as exc:
        details = exc.read(4_096).decode("utf-8", errors="ignore")
        log.warning("Safe Browsing upstream HTTP error: %s %s", exc.code, details[:200])
        raise HTTPException(502, "Safe Browsing upstream HTTP error") from exc
    except urllib.error.URLError as exc:
        log.warning("Safe Browsing upstream request failed: %s", exc.reason)
        raise HTTPException(502, "Safe Browsing upstream request failed") from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Safe Browsing check failed")
        raise HTTPException(500, "Safe Browsing check failed") from exc

    matches = parsed.get("matches") if isinstance(parsed, dict) else None
    threat_types = []
    if isinstance(matches, list):
        for item in matches[:8]:
            if isinstance(item, dict) and isinstance(item.get("threatType"), str):
                threat_types.append(item["threatType"])
            else:
                threat_types.append("UNKNOWN")

    return {
        "safe": len(threat_types) == 0,
        "threat_types": threat_types,
    }


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="SMaLL-100 translation daemon")
    parser.add_argument("--host", default=os.environ.get("TRANSLATE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("TRANSLATE_PORT", "7080")))
    args = parser.parse_args()

    log.info("Listening on http://%s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
