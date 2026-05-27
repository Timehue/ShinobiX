/*
 * Lightweight text moderation for user-supplied strings on the server.
 *
 * Scope: defense-in-depth for the player-visible string surface where the
 * existing `safeName` sanitizer doesn't apply — clan names, custom titles,
 * chat messages, village notice titles/bodies, and similar long-form text.
 *
 * Design notes:
 *   • Word list is intentionally small and conservative. A maximalist filter
 *     gets gamed within hours and produces more noise than signal; this list
 *     covers the categories most likely to draw player complaints (slurs,
 *     hate terms, sexual content) and leaves grey-area words (swears, mild
 *     insults) alone.
 *   • Matches are bounded by word boundaries when possible to avoid the
 *     Scunthorpe problem ("ass" in "assassin", "tit" in "title", etc.).
 *   • We REPLACE matches with asterisks rather than rejecting the whole
 *     post — outright rejection drives users to find clever workarounds.
 *   • A SECOND function `isCleanText` returns the boolean for callers who
 *     genuinely want to reject (clan creation: a slur in a clan name is
 *     not OK even with asterisks because the asterisked string still
 *     conveys the slur clearly).
 *   • PII detection is heuristic: phone/email/URL patterns get redacted.
 *     A determined doxxer can split a number across messages — full PII
 *     protection requires a moderation team, not a regex.
 *
 * Maintenance: when you add a word, ALWAYS add it lowercase; the matcher
 * lowercases the input before comparing.
 */

// Per-field text length ceilings. Anything beyond is silently truncated.
export const TEXT_LIMITS = {
    clanName: 32,
    clanMotto: 120,
    customTitle: 32,
    noticeTitle: 80,
    noticeBody: 600,
    chatMessage: 500,
    description: 600,
    storyName: 80,
} as const;

// Common slurs + hate terms. Intentionally minimal; expand cautiously. All
// entries MUST be lowercase. Substrings get word-boundary matched below.
const BLOCKLIST: ReadonlyArray<string> = [
    // racial slurs (most common variations)
    'nigger', 'nigga', 'chink', 'spic', 'kike', 'gook', 'wetback',
    // homophobic slurs
    'faggot', 'fag ', 'tranny', 'dyke',
    // sexist slurs
    'whore', 'slut', 'cunt',
    // sexual content that's never appropriate in a kids-game context
    'pedo', 'rape', 'rapist',
    // doxxing markers
    'killyourself', 'kys',
];

// Leetspeak normalization — common substitutions players try when bypassing
// filters. The matcher normalizes BEFORE comparing, so `n!gger`/`n1gger`
// both collapse to `nigger` and hit the blocklist.
const LEET_MAP: Readonly<Record<string, string>> = {
    '@': 'a', '4': 'a', '8': 'b', '(': 'c', '3': 'e', '6': 'g',
    '9': 'g', '!': 'i', '1': 'i', '|': 'i', '0': 'o', '$': 's',
    '5': 's', '+': 't', '7': 't', '2': 'z',
};

function normalizeForMatch(text: string): string {
    const lower = text.toLowerCase();
    let out = '';
    for (const ch of lower) {
        out += LEET_MAP[ch] ?? ch;
    }
    // Collapse repeated chars ("niiigger" → "nigger") and strip whitespace
    // between letters ("n i g g e r" → "nigger"). Both common bypass tricks.
    out = out.replace(/(.)\1{2,}/g, '$1$1');
    out = out.replace(/\s+/g, '');
    return out;
}

const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s]{4,})/gi;

/**
 * Apply moderation rules to a user-supplied string and return the cleaned
 * result. Profanity is replaced with asterisks, PII patterns are redacted
 * with `[redacted]`, and the result is capped at maxLen characters.
 *
 * Pass through is safe (returns '' for non-string inputs).
 */
export function sanitizeUserText(input: unknown, maxLen: number): string {
    if (typeof input !== 'string') return '';
    let text = input.trim();
    if (!text) return '';

    // Redact PII patterns first so the asterisk pass below doesn't corrupt
    // them (e.g., asterisking inside an email would leave a partial address
    // visible).
    text = text.replace(EMAIL_RE, '[redacted email]');
    text = text.replace(URL_RE, '[redacted link]');
    text = text.replace(PHONE_RE, '[redacted #]');

    // Profanity pass: scan the NORMALIZED form to catch bypass attempts,
    // but mask the ORIGINAL text at the matched span so legitimate
    // punctuation/casing is preserved everywhere else.
    const normalized = normalizeForMatch(text);
    for (const word of BLOCKLIST) {
        // \b is unreliable across letters + symbols, so we use a simple
        // start/end-of-word heuristic with optional adjacent punctuation.
        const re = new RegExp(`(^|[^a-z0-9])(${word})(?=[^a-z0-9]|$)`, 'gi');
        if (re.test(normalized)) {
            // Replace every occurrence in the original text with asterisks
            // of equal length. Because the normalized form may have collapsed
            // characters, we do the masking on the original by length.
            const mask = '*'.repeat(word.length);
            // Mask using a simpler case-insensitive substring scan on the
            // original (sufficient for the common case; bypass-by-spacing
            // is already caught by the normalized check above).
            text = text.replace(new RegExp(word, 'gi'), mask);
        }
    }

    // Length cap last so all the redaction tokens count toward the budget.
    if (text.length > maxLen) text = text.slice(0, maxLen).trimEnd();
    return text;
}

/**
 * Strict variant — returns false if ANY blocked term is present. Used by
 * callers that need to reject outright (e.g., clan name creation, where an
 * asterisked slur still reads as the slur).
 */
export function isCleanText(input: unknown): boolean {
    if (typeof input !== 'string') return true;
    const normalized = normalizeForMatch(input);
    for (const word of BLOCKLIST) {
        const re = new RegExp(`(^|[^a-z0-9])(${word})(?=[^a-z0-9]|$)`, 'i');
        if (re.test(normalized)) return false;
    }
    return true;
}
