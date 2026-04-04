"""
Quranic verse verification service.

Given an Arabic text snippet, searches the alquran.cloud API for matching
verses using the Uthmani script edition. If the best candidate matches with
≥ threshold similarity (default 70 %), returns the original verse with full
Tashkeel so the frontend can display it in a premium calligraphic font.

Matching is done after stripping diacritics and normalising common Arabic
glyph variants (alef forms, taa marbouta, etc.) so that auto-generated
captions — which almost never carry Tashkeel — can still match.
"""

import re
import json
import difflib
import urllib.request
import urllib.parse
from typing import Optional


# ── Arabic normalisation ──────────────────────────────────────────────────────

_TASHKEEL = re.compile(
    r"[\u0610-\u061A"   # Arabic Sign Sallallahou … Arabic Sign Jazm
    r"\u064B-\u065F"    # Fathatan … Wavy Hamza Below
    r"\u0670"           # Superscript Alef
    r"\u06D6-\u06DC"    # Small High Ligature … Small High Seen
    r"\u06DF-\u06E4"    # Small High Rounded Zero … Small High Madda
    r"\u06E7\u06E8"     # Small High Yeh … Small High Noon
    r"\u06EA-\u06ED]"   # Empty Centre Low Stop … Small Low Meem
)


def strip_tashkeel(text: str) -> str:
    """Remove all Arabic diacritical marks."""
    return _TASHKEEL.sub("", text)


def clean_youtube_text(text: str) -> str:
    """
    Remove YouTube auto-caption noise markers such as [موسيقى] (music),
    [تصفيق] (applause), [ضحك] (laughter) before comparison.
    Also strips square-bracketed Latin annotations.
    """
    return re.sub(r"\[[^\]]*\]", "", text).strip()


def normalize_arabic(text: str) -> str:
    """
    Produce a canonical form for fuzzy comparison only — never for display.
    Steps: clean YouTube markers → strip Tashkeel → unify alef variants →
           unify taa marbouta → keep only Arabic-block codepoints + spaces →
           collapse whitespace.
    """
    text = clean_youtube_text(text)
    text = strip_tashkeel(text)
    text = re.sub(r"[أإآٱ]", "ا", text)   # all alef forms → bare alef
    text = re.sub(r"ى", "ي", text)          # alef maqsura → yaa
    text = re.sub(r"ة", "ه", text)          # taa marbouta → haa
    text = re.sub(r"[^\u0600-\u06FF\s]", "", text)  # keep Arabic block + spaces
    return " ".join(text.split())


# ── API call ──────────────────────────────────────────────────────────────────

def _fetch_candidates(query: str) -> list[dict]:
    """
    Search alquran.cloud for *query* in the Uthmani script edition.
    Returns the raw match list (up to the first page of results).
    """
    encoded = urllib.parse.quote(query)
    url = f"https://api.alquran.cloud/v1/search/{encoded}/all/quran-uthmani"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "YTDLApp/1.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        payload = json.loads(resp.read())

    # Handle both possible response shapes from the API
    matches_obj = payload.get("data", {}).get("matches", {})
    if isinstance(matches_obj, dict):
        return matches_obj.get("data", [])
    if isinstance(matches_obj, list):
        return matches_obj
    return []


# ── Public interface ──────────────────────────────────────────────────────────

def verify_segment(text: str, threshold: float = 0.60) -> Optional[dict]:
    """
    Check whether *text* (an Arabic transcript segment) matches a Quranic verse.

    Returns a dict on success::

        {
            "uthmani":    str,   # full verse with Tashkeel
            "surah":      str,   # surah number
            "surah_name": str,   # e.g. "Al-Fatiha"
            "ayah":       str,   # verse number within surah
            "ratio":      float, # similarity score 0–1
        }

    Returns ``None`` if no match above *threshold* is found or on any error.
    """
    normalized = normalize_arabic(text)
    words = normalized.split()
    if len(words) < 4:
        return None  # too short for meaningful matching

    # Use the first 10 words as the search query
    query = " ".join(words[:10])

    try:
        candidates = _fetch_candidates(query)
    except Exception:
        return None

    best: Optional[dict] = None
    best_ratio = 0.0

    for candidate in candidates[:5]:
        verse_raw = candidate.get("text", "")
        verse_clean = normalize_arabic(verse_raw)
        ratio = difflib.SequenceMatcher(None, normalized, verse_clean).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best = candidate

    if best is None or best_ratio < threshold:
        return None

    surah_info = best.get("surah", {})
    return {
        "uthmani":    best.get("text", ""),
        "surah":      str(surah_info.get("number", "?")),
        "surah_name": surah_info.get("englishName", ""),
        "ayah":       str(best.get("numberInSurah", "?")),
        "ratio":      round(best_ratio, 3),
    }
