"""
LLM-powered transcript cleaning.

Works in any language. Fixes only what the auto-caption system broke.
Falls back to raw text if the model refuses or the output looks wrong.
"""

import re
import concurrent.futures
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
6. QUOTATION MARKS — When the speaker clearly quotes someone verbatim \
(e.g. "she said courage is...", "he told the crowd..."), add quotation marks \
around the quoted words and a comma before the attribution. \
Example: She said, "Courage is to tell the story of who you are with your whole heart."
7. HOMOPHONES — Fix obvious word mishearings that produce nonsense in context \
(e.g. "pre-cut hands" where context makes clear it should be "precut hams"). \
Only correct when the original word makes no sense and the intended word is unambiguous.
8. HYPHENATION — Hyphenate compound modifiers that appear before a noun \
(e.g. "sandy haired girl" → "sandy-haired girl", \
"long suffering husband" → "long-suffering husband").
9. AUDIENCE CUES — Preserve markers like (Laughter), (Applause), and (Music) \
exactly where they appear. Do NOT remove them, move them, or reformat them. \
These are positional cues that matter for readability and tone.
10. FILLER SOUNDS — Remove standalone filler sounds (um, uh, hmm, erm) that \
interrupt the flow of a sentence. Only remove them when they stand alone and \
do not carry meaning. Do NOT remove "well", "now", "so", or hesitations that \
are part of the speaker's natural rhetorical style.
11. COMMAS AROUND PARENTHETICALS — Add comma pairs around adverbial phrases \
that interrupt the main clause \
(e.g. "I am fortunately and frustratingly still the same" → \
"I am, fortunately and frustratingly, still the same").

FORBIDDEN:
- Do NOT change any word the speaker said.
- Do NOT rephrase, paraphrase, or improve any sentence.
- Do NOT add or remove words (other than filler sounds per rule 10 above).
- Do NOT add headings, bullet points, labels, or explanations.
- Do NOT comment on the language, the content, or your process.

OUTPUT: The cleaned transcript only. Paragraphs separated by a blank line.

RAW TRANSCRIPT:
{chunk}"""

# ── Anthropic client (singleton — reuse connection pool across calls) ─────────
_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key,
            timeout=60.0,   # 60s hard timeout per API call
        )
    return _client


# ── Refusal detection ─────────────────────────────────────────────────────────
_REFUSAL_PHRASES = re.compile(
    r"\b(I appreciate|I need to clarify|I cannot|I'm unable|I recommend|"
    r"my instructions|I'm happy to help|please note|however,? I)\b",
    re.IGNORECASE,
)


def _looks_like_refusal(cleaned: str, raw: str) -> bool:
    if _REFUSAL_PHRASES.search(cleaned):
        return True
    if len(raw.strip()) > 100 and len(cleaned.strip()) < len(raw.strip()) * 0.2:
        return True
    return False


# ── Chunking ──────────────────────────────────────────────────────────────────

_CHUNK_WORDS  = 800
_SENTENCE_END = re.compile(r'(?<=[.!?؟])\s+')


def _split_chunks(text: str) -> list[str]:
    """
    Split at sentence boundaries so no sentence is ever shared between chunks.
    Prevents Claude from repeating a dangling sentence across chunk boundaries.
    """
    sentences = _SENTENCE_END.split(text.strip())
    if not sentences:
        return [text]

    chunks: list[str] = []
    current_words = 0
    current: list[str] = []

    for sent in sentences:
        w = len(sent.split())
        if current and current_words + w > _CHUNK_WORDS:
            chunks.append(" ".join(current))
            current = []
            current_words = 0
        current.append(sent)
        current_words += w

    if current:
        chunks.append(" ".join(current))

    return chunks or [text]


# ── Per-chunk cleaning ────────────────────────────────────────────────────────

def _clean_chunk(client: anthropic.Anthropic, chunk: str) -> str:
    """Clean a single chunk. Returns raw chunk on failure or refusal."""
    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            system=_SYSTEM,
            messages=[{"role": "user", "content": _USER_TMPL.format(chunk=chunk)}],
        )
        result = response.content[0].text.strip()
        if _looks_like_refusal(result, chunk):
            return chunk
        return result
    except Exception:
        return chunk


# ── Main function ─────────────────────────────────────────────────────────────

def clean_transcript(raw_text: str) -> str:
    """
    Clean raw transcript text via Claude.
    Chunks are processed in parallel for speed.
    Returns raw_text unchanged if the API key is missing or the text is empty.
    """
    if not settings.anthropic_api_key or not raw_text.strip():
        return raw_text

    client = _get_client()
    chunks = _split_chunks(raw_text)

    # Process all chunks in parallel — a 4-chunk transcript goes from ~8s to ~2s
    max_workers = min(len(chunks), 5)  # cap at 5 parallel calls to avoid rate limits
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(_clean_chunk, client, chunk) for chunk in chunks]
        cleaned = [f.result() for f in futures]  # preserves order

    return "\n\n".join(c.strip() for c in cleaned if c.strip())
