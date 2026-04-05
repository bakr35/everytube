"""
LLM-powered transcript cleaning.

Works in any language. Fixes only what the auto-caption system broke.
Falls back to raw text if the model refuses or the output looks wrong.
"""

import re
import anthropic
from app.core.config import settings

# ── Prompt ────────────────────────────────────────────────────────────────────

_SYSTEM = (
    "You are a transcript formatter. "
    "You work in any language. "
    "You fix only what the auto-caption system broke — nothing else. "
    "You never refuse a request, never explain, never add commentary. "
    "You always return the cleaned transcript and nothing else."
)

_USER_TMPL = """\
The text below is a raw auto-generated YouTube transcript. \
It may be in any language — process it in whatever language it is written in.

Your job is strictly to fix what the automatic captioning system got wrong. \
Do NOT rewrite, improve, or change the speaker's words.

ALLOWED FIXES:
1. JOIN FRAGMENTS — Captions split sentences mid-word across lines. \
Join them back into complete sentences.
2. PARAGRAPHS — Group 3–5 sentences per paragraph. \
New paragraph when the speaker shifts to a new idea. Never break mid-sentence.
3. CAPITALISATION — Capitalise sentence starts and proper nouns \
using the rules of the transcript's language.
4. BRAND NAMES — Fix obvious auto-caption misspellings of brand/tech names \
(e.g. "open a i" → "OpenAI"). Only fix names that are clearly mis-transcribed.
5. PUNCTUATION — Add missing sentence-end punctuation where clearly needed. \
Follow the punctuation conventions of the transcript's language.
6. NOISE — Remove caption noise markers like [Music], [Applause], [Laughter].

FORBIDDEN:
- Do NOT change any word the speaker said.
- Do NOT rephrase, paraphrase, or improve any sentence.
- Do NOT add or remove words (except noise markers and filler sounds: um, uh, hmm).
- Do NOT add headings, bullet points, labels, or explanations.
- Do NOT comment on the language, the content, or your process.

OUTPUT: The cleaned transcript only. Paragraphs separated by a blank line.

RAW TRANSCRIPT:
{chunk}"""

# ── Refusal detection ─────────────────────────────────────────────────────────
# If the model talks about itself instead of returning the transcript, fall back.
_REFUSAL_PHRASES = re.compile(
    r"\b(I appreciate|I need to clarify|I cannot|I'm unable|I recommend|"
    r"my instructions|I'm happy to help|please note|however,? I)\b",
    re.IGNORECASE,
)


def _looks_like_refusal(cleaned: str, raw: str) -> bool:
    """Return True if the output is a refusal/explanation rather than a transcript."""
    # Refusal phrase detected
    if _REFUSAL_PHRASES.search(cleaned):
        return True
    # Output is less than 20% of the input length — something went very wrong
    if len(raw.strip()) > 100 and len(cleaned.strip()) < len(raw.strip()) * 0.2:
        return True
    return False


# ── Chunking ──────────────────────────────────────────────────────────────────

_CHUNK_WORDS    = 800   # target chunk size
_SENTENCE_END   = re.compile(r'(?<=[.!?؟])\s+')


def _split_chunks(text: str) -> list[str]:
    """
    Split at sentence boundaries so no sentence is ever shared between chunks.
    This prevents Claude from completing a dangling sentence in chunk N and
    then repeating it verbatim as the first sentence of chunk N+1.
    """
    # Split on whitespace after sentence-ending punctuation
    sentences = _SENTENCE_END.split(text.strip())
    if not sentences:
        return [text]

    chunks: list[str] = []
    current_words = 0
    current: list[str] = []

    for sent in sentences:
        w = len(sent.split())
        # If adding this sentence would push us over the limit AND we already
        # have content, flush first — unless the sentence alone exceeds the limit
        if current and current_words + w > _CHUNK_WORDS:
            chunks.append(" ".join(current))
            current = []
            current_words = 0
        current.append(sent)
        current_words += w

    if current:
        chunks.append(" ".join(current))

    return chunks or [text]


# ── Main function ─────────────────────────────────────────────────────────────

def clean_transcript(raw_text: str) -> str:
    """
    Clean raw transcript text via Claude.
    Returns raw_text unchanged if the API key is missing, the call fails,
    or the model returns a refusal instead of the cleaned transcript.
    """
    if not settings.anthropic_api_key or not raw_text.strip():
        return raw_text

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    chunks = _split_chunks(raw_text)
    cleaned: list[str] = []

    for chunk in chunks:
        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=4096,
                system=_SYSTEM,
                messages=[{"role": "user", "content": _USER_TMPL.format(chunk=chunk)}],
            )
            result = response.content[0].text.strip()

            # Validate — fall back to raw chunk if the model refused
            if _looks_like_refusal(result, chunk):
                cleaned.append(chunk)
            else:
                cleaned.append(result)

        except Exception:
            cleaned.append(chunk)

    return "\n\n".join(c.strip() for c in cleaned if c.strip())
