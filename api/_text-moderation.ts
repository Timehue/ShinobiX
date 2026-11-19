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
 *     insults) alone in chat. Player NAMES are stricter: they also refuse
 *     NAME_PROFANITY (swears and crude words), see isCleanPlayerName.
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

import { createHash } from 'node:crypto';

// Per-field text length ceilings. Anything beyond is silently truncated.
export const TEXT_LIMITS = {
    clanName: 32,
    clanMotto: 120,
    customTitle: 32,
    /**
     * Player DISPLAY name. 32 to match `safeName`'s SAFE_NAME_MAX_LEN, which already
     * truncates the derived slug used in every `save:`/`presence:` key — so a longer
     * display name could only ever disagree with the identity it maps to.
     *
     * This was previously unbounded at every layer: no `maxLength` on the creator
     * input, no ceiling in client validation, no check at registration, and no clamp
     * in the save sanitizer. Only the KEY was capped. A display name is rendered in
     * other players' UI — leaderboards, sector nameplates, chat, clan rosters — so an
     * unbounded one is a griefing vector that breaks layout for everyone but its owner.
     */
    playerName: 32,
    noticeTitle: 80,
    noticeBody: 600,
    /**
     * One line of a village's Town Hall activity log (`notices`). The longest line
     * the client writes is about 165: a 32-character name donating an 80-character
     * creator item to the stores, with its credit. A longer line (an admin item
     * with a longer name) is cut to this length, not refused.
     */
    villageActivityLine: 240,
    chatMessage: 500,
    description: 600,
    storyName: 80,
    trailSign: 120,
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

// Swears and crude words a player NAME may not contain (owner ruling
// 2026-10-15: "no bad names like fuck and shit"). Names only — chat keeps the
// conservative BLOCKLIST above, so ordinary swearing in conversation is not
// masked. Names have no word boundaries, so these are SUBSTRING-matched on the
// compacted name: every entry must be distinctive enough not to sit inside an
// ordinary fantasy name. Left out for that reason: "ass" (Assassin), "cock"
// (Peacock), "arse" (Arsenal), "anal" (Canal), "piss" (repeat-collapses to
// "pis": Pistol), "boob" ("bob"), "twat" ("Eastwatch" once spaces are gone).
// `_text-moderation.test.ts` checks this against the game's own content names.
const NAME_PROFANITY: ReadonlyArray<string> = [
    'fuck', 'fvck', 'phuck', 'fcuk', 'shit', 'bitch', 'bastard', 'asshole',
    'dick', 'cocksucker', 'pussy', 'wank', 'bollock', 'bellend',
    'penis', 'vagina', 'dildo', 'porn', 'tits', 'jizz', 'horny',
    'retard', 'nazi', 'hitler',
];

// Real words and surnames that contain a NAME_PROFANITY entry. They are cut out
// of the name before the scan, so whatever is left is still checked:
// "Yamashita" passes, "YamashitaShit" does not.
const NAME_PROFANITY_EXEMPT: ReadonlyArray<string> = [
    'yamashita', 'kinoshita', 'morishita', 'matsushita', 'takeshita', 'miyashita',
    'kishita', 'oshita', 'shitake', 'thorny', 'swank', 'nazir', 'dickens', 'riddick',
];

// Ordinary words and surnames that contain a BLOCKLIST entry as a substring.
// A name has no word boundaries, so without this "Grape", "Therapist",
// "Torpedo", "Spice" and "Nigeria" were refused at every sign-up door. Cut
// out before the scan exactly like NAME_PROFANITY_EXEMPT: the remainder is
// still checked, so "GrapeRapist" is still refused.
const BLOCKLIST_NAME_EXEMPT: ReadonlyArray<string> = [
    'grape', 'scrape', 'draper', 'drape', 'crape', 'therapist', 'torpedo',
    'spicer', 'spice', 'spicy', 'nigeria', 'scunthorpe', 'kikelomo', 'vandyke',
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
    // NFKD-fold accents/diacritics ("Ádmín" → "admin") and drop zero-width /
    // joiner / bidi characters ("Ad​min" → "admin") BEFORE mapping, so
    // homoglyph and invisible-character evasion collapses to the canonical
    // form the blocklist / reserved-term scan uses.
    const normalized = text
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')          // combining diacritics
        .replace(/[​-‏‪-‮⁠﻿­]/g, ''); // zero-width / bidi / soft hyphen
    let out = '';
    for (const ch of normalized.toLowerCase()) {
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
const COLLAPSED_NAME_PROFANITY: ReadonlyArray<string> = NAME_PROFANITY.map(w => leetCollapse(w));
const COLLAPSED_NAME_PROFANITY_EXEMPT: ReadonlyArray<string> = NAME_PROFANITY_EXEMPT.map(w => leetCollapse(w));
const COLLAPSED_BLOCKLIST_NAME_EXEMPT: ReadonlyArray<string> = BLOCKLIST_NAME_EXEMPT.map(w => leetCollapse(w));

/** True when a name, compacted the way isCleanPlayerName compacts it, holds a swear. */
export function hasNameProfanity(input: unknown): boolean {
    if (typeof input !== 'string') return false;
    let compact = leetCollapseStripSpace(input).replace(/[^a-z0-9]/g, '');
    for (const safe of COLLAPSED_NAME_PROFANITY_EXEMPT) compact = compact.split(safe).join(' ');
    return COLLAPSED_NAME_PROFANITY.some((term) => compact.includes(term));
}

const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/g;
// Bounded quantifiers (RFC 5321 lengths) keep this linear. The unbounded form
// `[\w.+-]+@…` re-scanned the whole run from every start position, so a long
// string with no '@' cost O(n²): 20k characters blocked the event loop ~0.9 s.
const EMAIL_RE = /[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{1,190}/g;
/**
 * How much raw input sanitizeUserText scans. The result is cut to maxLen
 * anyway; the slack covers redactions that shorten text (a long link becomes
 * "[redacted link]") so the visible tail is unchanged for any real message.
 * Without this bound, a 1 MB DM or chat line ran every regex below over the
 * full body on the single Node process.
 */
function sanitizeScanLimit(maxLen: number): number {
    const len = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 0;
    return len * 4 + 256;
}
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
    const scanLimit = sanitizeScanLimit(maxLen);
    let text = (input.length > scanLimit ? input.slice(0, scanLimit) : input).trim();
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
    // Also catch the two spellings the word-boundary scans miss: letters joined
    // by punctuation inside ONE word ("n-i-g-g-e-r", "n.i.g.g.e.r") and a word
    // spelled as a run of very short tokens ("n i g g e r", "ra pe"). Each of
    // those is compacted ON ITS OWN. This pass used to compact the WHOLE
    // message, so letters from adjacent ordinary words formed a blocked term
    // ("for a pet", "let's pick", "who really", "such ink", "candy kept") and
    // the whole line was refused in every chat. Restricted to longer blocked
    // terms to avoid accidental matches from short abbreviations.
    const compactCandidates: string[] = [];
    let shortRun: string[] = [];
    const flushShortRun = () => {
        if (shortRun.length >= 2) compactCandidates.push(leetCollapse(shortRun.join('')));
        shortRun = [];
    };
    for (const token of collapsedWithSpace.split(/\s+/)) {
        const compact = token.replace(/[^a-z0-9]/g, '');
        if (!compact) { flushShortRun(); continue; }
        if (compact !== token) compactCandidates.push(leetCollapse(compact));
        if (compact.length <= 2) shortRun.push(compact);
        else flushShortRun();
    }
    flushShortRun();
    for (const canonical of COLLAPSED_BLOCKLIST) {
        const re = new RegExp(`(^|[^a-z0-9])(${canonical})(?=[^a-z0-9]|$)`, 'i');
        if (re.test(collapsedWithSpace) || re.test(collapsedNoSpace)) return false;
        const compactTerm = canonical.replace(/[^a-z0-9]/g, '');
        if (compactTerm.length >= 4 && compactCandidates.some((candidate) => candidate.includes(compactTerm))) return false;
    }
    return true;
}

/**
 * Strict identity variant for new player names. Usernames have no reliable
 * word boundaries, so a blocked term embedded in a name must be rejected
 * rather than relying on the prose-oriented boundary matcher above. Very
 * short shorthand terms are deliberately excluded here to avoid false
 * positives in otherwise harmless fantasy names.
 */
export function isCleanPlayerName(input: unknown): boolean {
    if (typeof input !== 'string') return false;
    const canonical = leetCollapseStripSpace(input).replace(/[^a-z0-9]/g, '');
    if (!canonical) return false;
    // The language filter is the ONLY thing that limits a name (owner ruling
    // 2026-10-15). No franchise/trademark list: players may name themselves
    // anything that is not offensive.
    if (hasNameProfanity(input)) return false;
    let scan = canonical;
    for (const safe of COLLAPSED_BLOCKLIST_NAME_EXEMPT) scan = scan.split(safe).join(' ');
    return !COLLAPSED_BLOCKLIST
        .filter((term) => term.length >= 4)
        .some((term) => scan.includes(term));
}

// ─── Custom-title moderation (docs/legacy-system-plan.md §11.4) ─────────────
//
// Custom titles are cosmetic free text, but they render next to a player's
// name everywhere — so authority/impersonation terms are rejected outright
// (filter-first; a rejected title is never charged because the sanitizer
// strips it before any purchase state can matter). Earned titles ("Gate
// Opener", "Season Champion") are ALSO reserved as free text: they can only
// be worn by a player who actually owns them (api/save/[name].ts checks
// ownership against server-trusted grants via api/_titles-registry.ts).

/** Authority / impersonation / system terms banned inside custom titles.
 *  Matched leetspeak-collapsed with word boundaries, same as the blocklist.
 *  Deliberately does NOT include bare game-vocabulary tokens that collide with
 *  legitimate titles — "kage" (villages have Kages), "mod"/"dev"/"gm"/"system"/
 *  "server" as standalone words — only full impersonation phrases. "Kage" as an
 *  EARNED rank is protected separately via the earned-title ownership check. */
export const RESERVED_TITLE_TERMS: readonly string[] = [
    'admin', 'administrator', 'moderator', 'owner', 'developer',
    'staff', 'official', 'game master', 'gamemaster',
    'server first', 'world first', 'hall of legends',
    'anthropic', 'system message', 'game master',
];

/**
 * Reserved title words that belong to another series. They are stored only as
 * SHA-256 hashes so this repository never spells them out: five leader titles
 * that read as an official village rank. Each hash is of the term after
 * `leetCollapse` with every non-alphanumeric character removed, so the hash
 * matches the canonical form the input is reduced to. To add one, hash that
 * canonical form. `_text-moderation-titles.test.ts` pins this list, and
 * `scripts/ip-hygiene.test.mjs` checks that every entry is also guarded there.
 */
export const RESERVED_TITLE_TERM_HASHES: ReadonlySet<string> = new Set([
    '332cde01112429bacd16b06ef342ac283ab78ca5721260fbc919afad3587765f',
    'eba2ead8ff67d87403ceab1202f451edbd61958c85615a1197f5fdf197d0bc15',
    '9d05784afac36a2a0499e50a4345ee6fed252d4d964f942404f253935b195c95',
    '9c466412766035c349dd53f9862eeeff9093d5c3c62ba236e209b7f79af372b4',
    '379ee033aa10b319a18fd2750715bd1bfc483502e2f251347dc22fdc504e0ce0',
]);

const COLLAPSED_RESERVED = RESERVED_TITLE_TERMS.map((t) => leetCollapseStripSpace(t));

/** How many neighbouring words a hashed term may be split across ("ab cd ef"). */
const HASHED_TERM_MAX_PARTS = 4;

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * True when a hashed term appears as a whole word of the collapsed text, or
 * spelled across up to four neighbouring words joined by spaces or punctuation
 * ("ab-cd", "ab.cd", "ab cd"). Matching is on whole words only, like the
 * word-boundary regex used for the plain-text terms, so a term inside a longer
 * word ("xabcdx") is not a match. Exported so tests can drive it with invented
 * terms instead of the real ones.
 */
export function hasHashedTerm(input: unknown, hashes: ReadonlySet<string>): boolean {
    if (typeof input !== 'string' || !input.trim() || hashes.size === 0) return false;
    const seen = new Set<string>();
    const isHashed = (candidate: string): boolean => {
        if (seen.has(candidate)) return false;
        seen.add(candidate);
        return hashes.has(sha256Hex(candidate));
    };
    for (const collapsed of [leetCollapsePreserveSpace(input), leetCollapseStripSpace(input)]) {
        const words = collapsed.match(/[a-z0-9]+/g) ?? [];
        for (let i = 0; i < words.length; i++) {
            let joined = '';
            for (let j = i; j < Math.min(words.length, i + HASHED_TERM_MAX_PARTS); j++) {
                joined += words[j];
                if (isHashed(joined)) return true;
                // The joined form goes through the same repeat collapse the
                // term's canonical hash was taken from ("ab" + "bc" → "abc").
                const recollapsed = joined.replace(/(.)\1+/g, '$1');
                if (recollapsed !== joined && isHashed(recollapsed)) return true;
            }
        }
    }
    return false;
}

/** True when the text contains a reserved authority/impersonation term. */
export function hasReservedTitleTerm(input: unknown): boolean {
    if (typeof input !== 'string' || !input.trim()) return false;
    const collapsedWithSpace = leetCollapsePreserveSpace(input);
    const collapsedNoSpace = leetCollapseStripSpace(input);
    for (const canonical of COLLAPSED_RESERVED) {
        const re = new RegExp(`(^|[^a-z0-9])(${canonical})(?=[^a-z0-9]|$)`, 'i');
        if (re.test(collapsedWithSpace) || re.test(collapsedNoSpace)) return true;
    }
    return hasHashedTerm(input, RESERVED_TITLE_TERM_HASHES);
}

// Staff words a NAME may not open or close with. Names have no reliable word
// boundaries ("AdminRill", "xXModeratorXx"), so the word-boundary title check
// alone misses them; prefix/suffix on the compacted form catches the common
// impersonation shapes without banning names that merely contain the letters
// in the middle ("Badminton"). Short tokens ("mod", "gm", "dev") are left out
// on purpose — too many ordinary names start with them.
const STAFF_NAME_EDGE_TERMS = ['admin', 'administrator', 'moderator', 'gamemaster', 'developer', 'staff', 'official'];

/**
 * True when a player NAME would read as staff: any reserved title term as a
 * word, or a staff word at either end of the compacted name. Names render in
 * chat, whispers and leaderboards, so "Admin" or "OfficialModerator" is an
 * impersonation surface just as a title is.
 */
export function hasStaffImpersonationName(input: unknown): boolean {
    if (typeof input !== 'string' || !input.trim()) return false;
    if (hasReservedTitleTerm(input)) return true;
    const compact = leetCollapseStripSpace(input).replace(/[^a-z0-9]/g, '');
    return STAFF_NAME_EDGE_TERMS.some((term) => compact.startsWith(term) || compact.endsWith(term));
}

/**
 * Full custom-title gate: clean (no profanity), no reserved terms, sane
 * length. Ownership of earned-title strings is checked separately by the
 * caller (it needs the player's server-trusted grants).
 */
export function isAllowedCustomTitle(input: unknown): boolean {
    if (typeof input !== 'string') return false;
    const text = input.trim();
    if (!text) return true; // clearing the title is always allowed
    if (text.length > TEXT_LIMITS.customTitle) return false;
    if (!isCleanText(text)) return false;
    if (hasReservedTitleTerm(text)) return false;
    return true;
}
