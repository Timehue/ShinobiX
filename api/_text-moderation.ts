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
    // Cyrillic / Greek lookalikes that render identically to Latin chars
    // in most fonts — common in slur-evasion attempts.
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p',
    'с': 'c', 'х': 'x', 'у': 'y', 'ο': 'o',
    'α': 'a', 'ε': 'e', 'ρ': 'p',
    // Full-width Latin lookalikes
    'ａ': 'a', 'ｅ': 'e', 'ｏ': 'o', 'ｉ': 'i',
};

// Two normalizer variants. We check BOTH against the blocklist — either
// match triggers the rule. The split is so the word-boundary scan still
// works for plain text (which needs whitespace preserved) while the
// whitespace-separation bypass also gets caught.
function leetCollapse(text: string): string {
    let out = '';
    for (const ch of text.toLowerCase()) {
        out += LEET_MAP[ch] ?? ch;
    }
    // Aggressive repeat collapse — squash any run of the same char to 1.
    // This catches "niiigger" (3+i) and "nigggger" (extra g) variants. The
    // blocklist's canonical forms ("nigger") survive because they're scanned
    // against this same aggressive form (the canonical also collapses to
    // "niger", so we collapse the blocklist entries the same way below).
    out = out.replace(/(.)\1+/g, '$1');
    return out;
}

function leetCollapsePreserveSpace(text: string): string {
    return leetCollapse(text);
}

function leetCollapseStripSpace(text: string): string {
    // Strip whitespace BEFORE the repeat collapse so adjacent-letter runs
    // across spaces ("n i g g e r" → "nigger" → "niger") collapse to the
    // same canonical form as the blocklist entries. Stripping after the
    // collapse leaves the per-letter runs intact and the canonical match
    // misses.
    return leetCollapse(text.replace(/\s+/g, ''));
}

// Pre-collapse the blocklist so the matcher can compare apples to apples.
// We don't store a non-collapsed copy — every blocklist check goes through
// the same normalizer that the input does.
const COLLAPSED_BLOCKLIST: ReadonlyArray<string> = BLOCKLIST.map(w => leetCollapse(w));

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

    // Profanity pass: two checks against the blocklist.
    //   • word-boundary scan on a space-preserving collapse (catches plain
    //     prose: "you are a whore" → "you are a whore" → match)
    //   • word-boundary scan on a space-stripped collapse (catches the
    //     "n i g g e r" bypass)
    // Both normalizations also fold leetspeak (@→a, 1→i, etc.) and squash
    // repeat-character runs so "niiigger" / "n!gger" / "n1gger" all collapse
    // to the same canonical form the blocklist stores.
    const collapsedWithSpace = leetCollapsePreserveSpace(text);
    const collapsedNoSpace = leetCollapseStripSpace(text);
    for (let i = 0; i < BLOCKLIST.length; i++) {
        const original = BLOCKLIST[i]!;
        const canonical = COLLAPSED_BLOCKLIST[i]!;
        const re = new RegExp(`(^|[^a-z0-9])(${canonical})(?=[^a-z0-9]|$)`, 'i');
        const hit = re.test(collapsedWithSpace) || re.test(collapsedNoSpace);
        if (hit) {
            // Mask the original word form in the visible string. If it doesn't
            // appear literally (bypass attempt), the redacted output still
            // includes the offensive content in some altered form, but the
            // boolean isCleanText path is what callers use to outright reject.
            const mask = '*'.repeat(Math.max(3, original.length));
            text = text.replace(new RegExp(original, 'gi'), mask);
            // Also redact any contiguous letter-run that collapses to the
            // canonical form (catches "whooore" etc. where the original
            // literal regex misses).
            const fuzzy = new RegExp(canonical.split('').map(c => `${c}+`).join('\\W*'), 'gi');
            text = text.replace(fuzzy, mask);
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
    const collapsedWithSpace = leetCollapsePreserveSpace(input);
    const collapsedNoSpace = leetCollapseStripSpace(input);
    for (const canonical of COLLAPSED_BLOCKLIST) {
        const re = new RegExp(`(^|[^a-z0-9])(${canonical})(?=[^a-z0-9]|$)`, 'i');
        if (re.test(collapsedWithSpace) || re.test(collapsedNoSpace)) return false;
    }
    return true;
}
