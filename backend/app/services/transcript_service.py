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
    # ── ASR-split compound words ──────────────────────────────────────────────
    # ASR frequently splits compound words; the split form is essentially never
    # the intended meaning in transcription context.
    (r'\bwork\s+flow\b',               'workflow'),
    (r'\bdata\s+base\b',               'database'),
    (r'\bfire\s+wall\b',               'firewall'),
    (r'\bkey\s+board\b',               'keyboard'),
    (r'\bkey\s+note\b',                'keynote'),
    (r'\bnet\s+work\b',                'network'),
    (r'\bover\s+all\b',                'overall'),
    (r'\bback\s+end\b',                'backend'),
    (r'\bfront\s+end\b',               'frontend'),
    (r'\bfull\s+stack\b',              'full-stack'),
    (r'\bopen\s+source\b',             'open-source'),
    (r'\bread\s+me\b',                 'README'),
    (r'\btime\s+stamp\b',              'timestamp'),
    (r'\btime\s+line\b',               'timeline'),
    (r'\bscreen\s+shot\b',             'screenshot'),
    (r'\bweb\s+site\b',                'website'),
    (r'\bweb\s+hook\b',                'webhook'),
    (r'\bcheck\s+box\b',               'checkbox'),
    (r'\bdrop\s+down\b',               'dropdown'),
    (r'\bpop\s+up\b',                  'pop-up'),
    (r'\bset\s+up\b(?=\s+(?:a|an|the|your|my|our|their|this|that|is|was)\b)', 'setup'),
    (r'\blog\s+in\b(?=\s+(?:page|screen|form|button|flow|process)\b)',         'login'),
    (r'\bsign\s+in\b(?=\s+(?:page|screen|form|button|flow|process)\b)',        'sign-in'),
    (r'\bsign\s+up\b(?=\s+(?:page|screen|form|button|flow|process)\b)',        'sign-up'),
    # ── ASR homophones (wrong form essentially never correct in context) ───────
    # Only add pairs where the "wrong" form is near-impossible in normal speech.
    (r'\bpre[\s\-]cut\s+hands?\b',     'precut hams'),   # ASR: "ham" → "hand"
    (r'\bpre[\s\-]cut\s+palms?\b',     'pre-cut hams'),  # ASR: "ham" → "palm" (this specific talk)
    (r'\biced\s+team\b',               'iced tea'),       # "I'd like some iced team"
    (r'\beye\s+scream\b',              'ice cream'),
    (r'\bwrap\s+per\b',                'wrapper'),
    (r'\bex\s+port\b(?=\s+(?:the|a|an|your|my|our|this|that|it|them|data|file)\b)', 'export'),
    (r'\bim\s+port\b(?=\s+(?:the|a|an|your|my|our|this|that|it|them|data|file)\b)', 'import'),
]

# Noise segment pattern (music markers, applause, etc.)
_NOISE_RE = re.compile(r'^\s*[\[♪♫<][^\]>]*[\]>]?\s*$|^\s*[♪♫]\s*$', re.UNICODE)

# Maps raw caption noise text → inline audience cue marker
_AUDIENCE_CUES: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\blaughter\b',  re.IGNORECASE), '(Laughter)'),
    (re.compile(r'\bapplause\b',  re.IGNORECASE), '(Applause)'),
    (re.compile(r'\bmusic\b',     re.IGNORECASE), '(Music)'),
    (re.compile(r'\bcheering\b',  re.IGNORECASE), '(Cheering)'),
    (re.compile(r'\bclapping\b',  re.IGNORECASE), '(Applause)'),
    (re.compile(r'[♪♫]',                        ), '(Music)'),
]


def _extract_audience_cue(text: str) -> str | None:
    """
    Convert a noise segment like "[Laughter]" or "♪" into a readable inline
    cue like "(Laughter)". Returns None if the noise has no audience meaning.
    """
    for pattern, marker in _AUDIENCE_CUES:
        if pattern.search(text):
            return marker
    return None

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

    # Clean each segment's text; drop noise and subtitle credit lines.
    # Strip YouTube ">>" speaker-change markers from text but do NOT assign
    # speaker labels — YouTube's ">>" only means "a change occurred" and cannot
    # reliably identify which person is speaking. Speaker labels come from
    # WhisperX diarization only (Whisper path).
    segments = []
    for s in raw:
        t = _clean_segment(s.text)
        if not t or _CREDIT_RE.match(t):
            continue

        # Noise segment — convert known audience cues to inline markers,
        # drop everything else (music stings, etc. with no audience meaning)
        if _NOISE_RE.match(t):
            cue = _extract_audience_cue(t)
            if cue:
                segments.append({
                    "text":     cue,
                    "start":    s.start,
                    "duration": s.duration,
                    "speaker":  None,
                    "is_cue":   True,
                })
            continue

        # Strip ">>" prefix without assigning a speaker
        if t.startswith(">>"):
            t = re.sub(r'^>>\s*', '', t).strip()
            if not t:
                continue

        segments.append({
            "text":     t,
            "start":    s.start,
            "duration": s.duration,
            "speaker":  None,
        })

    # Build raw joined text then pass through LLM cleaner
    raw_joined = " ".join(s["text"] for s in segments)
    full_text   = clean_transcript(raw_joined)
    # Safety net: enforce brand name casing after Claude (e.g. "openai" → "OpenAI")
    full_text   = _apply_brand_corrections(full_text)

    result = {
        "video_id": video_id,
        "language": target.language_code,
        "segments": segments,
        "full_text": full_text,
    }

    # ── Persist to cache ──────────────────────────────────────────────────────
    save_transcript(result)

    return result
