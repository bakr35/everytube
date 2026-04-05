import html
import re
import http.cookiejar
from pathlib import Path

import requests
from app.services.transcript_cleaner import clean_transcript
from app.core.config import settings
from app.core.cache import get_transcript, save_transcript
from youtube_transcript_api import (
    YouTubeTranscriptApi,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)
from urllib.parse import urlparse, parse_qs


def _make_api() -> YouTubeTranscriptApi:
    """
    Build a YouTubeTranscriptApi instance, attaching browser cookies when a
    cookies file is configured — this bypasses YouTube's IP-based rate limits.
    """
    cookies_path = Path(settings.cookies_file) if settings.cookies_file else None
    if cookies_path and cookies_path.is_file():
        jar = http.cookiejar.MozillaCookieJar(str(cookies_path))
        jar.load(ignore_discard=True, ignore_expires=True)
        session = requests.Session()
        session.cookies = jar
        return YouTubeTranscriptApi(http_client=session)
    return YouTubeTranscriptApi()

# ── Brand / term correction patterns ─────────────────────────────────────────
# Each entry: (case-insensitive regex, replacement)
_BRAND_PATTERNS: list[tuple[str, str]] = [
    # OpenAI variants (ASR errors: "Open A I", "Open AAI", possessives/plurals)
    (r'\bopen\s+a+\s*is\b',             'OpenAIs'),   # "Open AAIs" (plural w/o apostrophe)
    (r'\bopen\s+a+\s*i\b',              'OpenAI'),    # "Open AAI", "Open AAI's" (\b before ')
    (r'\bopenai\b',                      'OpenAI'),
    # ChatGPT and GPT models (incl. common mishearing "Chat GBT")
    (r'\bchat[\s\-]?g[bp]t\b',          'ChatGPT'),
    (r'\bgpt[\s\-]4o\b',                'GPT-4o'),
    (r'\bgpt[\s\-]4\b',                 'GPT-4'),
    (r'\bgpt[\s\-]3\.5\b',              'GPT-3.5'),
    (r'\bgpt[\s\-]3\b',                 'GPT-3'),
    (r'\bgpt[\s\-](\d)',                r'GPT-\1'),
    # Other AI companies / models
    (r'\banthrop[il]c\b',               'Anthropic'),
    (r'\bgemini\b',                     'Gemini'),
    (r'\bco[\s\-]?pilot\b',             'Copilot'),
    (r'\bdall[\s\-]?e\b',               'DALL-E'),
    (r'\bmid[\s\-]?journey\b',          'Midjourney'),
    (r'\bstable[\s\-]?diffusion\b',     'Stable Diffusion'),
    (r'\bhugging[\s\-]?face\b',         'Hugging Face'),
    # Platforms
    (r'\byou[\s\-]?tube\b',             'YouTube'),
    (r'\bgit[\s\-]?hub\b',              'GitHub'),
    (r'\blinked[\s\-]?in\b',            'LinkedIn'),
    (r"\bwhat[\s\u2019']s[\s\-]?app\b",  'WhatsApp'),
    (r'\btik[\s\-]?tok\b',              'TikTok'),
    (r'\bstack[\s\-]?overflow\b',       'Stack Overflow'),
    # Apple
    (r'\bi[\s\-]?phone\b',              'iPhone'),
    (r'\bi[\s\-]?pad\b',                'iPad'),
    (r'\bi[\s\-]?mac\b',                'iMac'),
    (r'\bmac[\s\-]?book\b',             'MacBook'),
    (r'\bmac[\s\-]?os\b',               'macOS'),
    (r'\bios\b',                        'iOS'),
    (r'\bapp\s*store\b',                'App Store'),
    # Web tech
    (r'\bjava[\s\-]?script\b',          'JavaScript'),
    (r'\btype[\s\-]?script\b',          'TypeScript'),
    (r'\bweb[\s\-]?assembly\b',         'WebAssembly'),
    (r'\bnode[\s\.]?js\b',              'Node.js'),
    (r'\breact[\s\.]?js\b',             'React.js'),
    (r'\bvue[\s\.]?js\b',               'Vue.js'),
    (r'\bnext[\s\.]?js\b',              'Next.js'),
    (r'\bpostgre[\s\-]?sql\b',          'PostgreSQL'),
    (r'\bmongo[\s\-]?db\b',             'MongoDB'),
    # Cloud
    (r'\bamazon\s+web\s+services\b',    'Amazon Web Services'),
    (r'\b(?<!\w)aws\b',                 'AWS'),
    (r'\bgoogle\s+cloud\b',             'Google Cloud'),
    (r'\bmicrosoft\s+azure\b',          'Microsoft Azure'),
    # Acronyms (standalone only, word boundaries prevent false hits)
    (r'\b(?<!\w)ai\b(?!\w)',            'AI'),
    (r'\b(?<!\w)ml\b(?!\w)',            'ML'),
    (r'\b(?<!\w)nlp\b(?!\w)',           'NLP'),
    (r'\b(?<!\w)llm\b(?!\w)',           'LLM'),
    (r'\b(?<!\w)api\b(?!\w)',           'API'),
    (r'\b(?<!\w)url\b(?!\w)',           'URL'),
    (r'\b(?<!\w)html\b(?!\w)',          'HTML'),
    (r'\b(?<!\w)css\b(?!\w)',           'CSS'),
    (r'\b(?<!\w)json\b(?!\w)',          'JSON'),
    (r'\b(?<!\w)cpu\b(?!\w)',           'CPU'),
    (r'\b(?<!\w)gpu\b(?!\w)',           'GPU'),
    (r'\b(?<!\w)ram\b(?!\w)',           'RAM'),
    (r'\b(?<!\w)sdk\b(?!\w)',           'SDK'),
    (r'\b(?<!\w)ide\b(?!\w)',           'IDE'),
    (r'\b(?<!\w)ui\b(?!\w)',            'UI'),
    (r'\b(?<!\w)ux\b(?!\w)',            'UX'),
]

# Noise segment pattern (music markers, applause, etc.)
_NOISE_RE = re.compile(r'^\s*[\[♪♫<][^\]>]*[\]>]?\s*$|^\s*[♪♫]\s*$', re.UNICODE)

# Subtitle credit lines injected by TED / community translators — not spoken content
_CREDIT_RE = re.compile(
    r'^\s*(Translator|Reviewer|Transcriber|Subtitles?\s+by|Captions?\s+by'
    r'|Translated\s+by|Reviewed\s+by|Proofread\s+by)\s*:',
    re.IGNORECASE,
)


def _extract_video_id(url: str) -> str:
    if "youtu.be" in url:
        return urlparse(url).path.lstrip("/").split("?")[0]

    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    if "v" in qs:
        return qs["v"][0]

    match = re.search(r"/(shorts|embed|v)/([a-zA-Z0-9_-]{11})", parsed.path)
    if match:
        return match.group(2)

    raise ValueError(f"Could not extract video ID from URL: {url}")


# ── Per-segment text cleaning ─────────────────────────────────────────────────

def _clean_segment(text: str) -> str:
    """
    Unescape HTML entities, strip noise markers, normalize whitespace.
    Does NOT alter words or brand names (keep segments faithful for SRT).
    """
    text = html.unescape(text)                     # &#39; → ', &amp; → &
    text = re.sub(r'[\n\r\t]+', ' ', text)         # newlines → space
    text = re.sub(r'[ \u00a0\u200b]+', ' ', text)  # non-breaking / zero-width spaces
    text = text.strip()
    return text


# ── Full-text post-processing ─────────────────────────────────────────────────

def _apply_brand_corrections(text: str) -> str:
    for pattern, replacement in _BRAND_PATTERNS:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text


def _fix_capitalization(text: str) -> str:
    """
    - Capitalise first character of the whole text.
    - Capitalise the first letter after a sentence-ending punctuation mark.
    - Correct standalone lowercase 'i' → 'I'.
    """
    if not text:
        return text

    # Capitalise first letter
    text = text[0].upper() + text[1:]

    # Capitalise after . ! ?  (but not after abbreviations like "U.S.")
    def _cap(m: re.Match) -> str:
        return m.group(1) + m.group(2).upper()

    text = re.sub(r'([.!?]\s+)([a-z])', _cap, text)

    # Standalone 'i' → 'I'
    text = re.sub(r'(?<!\w)i(?!\w)', 'I', text)

    return text


def _remove_filler_sounds(text: str) -> str:
    """
    Remove common filler sounds that appear in auto-generated captions.
    Operates on the joined full text only (not on per-segment text).
    """
    # um, uh, hmm at word boundaries — remove with any surrounding spaces
    text = re.sub(r'\b(um+|uh+|hmm+|mm+|ah+|er+)\b,?\s*', '', text, flags=re.IGNORECASE)
    # Remove duplicate consecutive words (e.g., "the the")
    text = re.sub(r'\b(\w+)\s+\1\b', r'\1', text, flags=re.IGNORECASE)
    # Clean up extra spaces left by removals
    text = re.sub(r' {2,}', ' ', text).strip()
    return text


def _reconstruct_full_text(segments: list[dict]) -> str:
    """
    Build a clean, readable full-text from raw segments:
      1. Join cleaned segment texts.
      2. Remove noise (music / applause markers).
      3. Apply brand corrections.
      4. Fix capitalization.
      5. Remove filler sounds.
      6. Group into paragraphs (~4 sentences, falling back to word-count if no punctuation).
    """
    # Filter noise segments and subtitle credits; clean and join the rest
    clean_parts: list[str] = []
    for s in segments:
        t = _clean_segment(s['text'])
        if t and not _NOISE_RE.match(t) and not t.startswith('>>') and not _CREDIT_RE.match(t):
            clean_parts.append(t)

    raw = ' '.join(clean_parts)
    raw = re.sub(r' {2,}', ' ', raw).strip()

    if not raw:
        return ''

    # Brand corrections on joined text (catches cross-segment brand names)
    raw = _apply_brand_corrections(raw)
    raw = _fix_capitalization(raw)
    raw = _remove_filler_sounds(raw)

    # ── Paragraph grouping ────────────────────────────────────────────────────
    SENTENCES_PER_PARA = 4
    WORDS_PER_PARA     = 80   # fallback when text has no punctuation

    # Split on sentence-ending punctuation
    sentence_splits = re.split(r'(?<=[.!?])\s+', raw)
    sentences = [s.strip() for s in sentence_splits if s.strip()]

    if len(sentences) <= 1:
        # No sentence punctuation detected — fall back to word-count chunking
        words = raw.split()
        chunks = [
            ' '.join(words[i:i + WORDS_PER_PARA])
            for i in range(0, len(words), WORDS_PER_PARA)
        ]
        return '\n\n'.join(chunks)

    # Group sentences into paragraphs
    paras: list[str] = []
    for i in range(0, len(sentences), SENTENCES_PER_PARA):
        chunk = sentences[i:i + SENTENCES_PER_PARA]
        paras.append(' '.join(chunk))

    return '\n\n'.join(paras)


# ── Public API ────────────────────────────────────────────────────────────────

def fetch_transcript(url: str, language: str = "auto") -> dict:
    video_id = _extract_video_id(url)

    # ── Cache hit ─────────────────────────────────────────────────────────────
    cached = get_transcript(video_id)
    if cached:
        return cached

    api = _make_api()

    transcript_list = api.list(video_id)
    available = list(transcript_list)

    if not available:
        raise NoTranscriptFound(video_id, [language], transcript_list)

    # Pick the best transcript for the requested language.
    #
    # "auto" priority (matches the video's original language):
    #   1. Auto-generated  — YouTube generates these in the original spoken language
    #   2. Manual English  — fallback for videos with only human-reviewed EN captions
    #   3. Any manual      — last resort
    #   4. First available
    #
    # Community translations (e.g. TED-Ed Albanian) are manual but NOT the original
    # language, so they rank below auto-generated originals.
    target = None
    if language != "auto":
        for t in available:
            if t.language_code == language:
                target = t
                break

    if target is None:
        generated  = [t for t in available if t.is_generated]
        manual_en  = [t for t in available if not t.is_generated and t.language_code.startswith("en")]
        manual_any = [t for t in available if not t.is_generated]
        target = (generated or manual_en or manual_any or available)[0]

    raw = target.fetch()

    # Clean each segment's text; drop noise and subtitle credit lines
    segments = []
    for s in raw:
        t = _clean_segment(s.text)
        if t and not _NOISE_RE.match(t) and not _CREDIT_RE.match(t):
            segments.append({"text": t, "start": s.start, "duration": s.duration})

    # Build raw joined text then pass through LLM cleaner
    raw_joined = " ".join(s["text"] for s in segments)
    full_text   = clean_transcript(raw_joined)

    result = {
        "video_id": video_id,
        "language": target.language_code,
        "segments": segments,
        "full_text": full_text,
    }

    # ── Persist to cache ──────────────────────────────────────────────────────
    save_transcript(result)

    return result
