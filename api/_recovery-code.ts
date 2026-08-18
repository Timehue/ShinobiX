/**
 * Recovery codes — the self-serve way back into a password account.
 *
 * Underscore-prefixed: shared helper, not a route.
 *
 * ## Why a code and not an email link
 *
 * Accounts here are keyed by the `safeName` slug and nothing else. Registration
 * never asks for an email, guest play asks for nothing at all, and the only
 * accounts carrying an address are the Google-linked ones — which already have
 * a working recovery door in "sign in with Google". So an email reset would
 * cover approximately none of the population that actually needs it, while
 * looking from the outside like the problem was solved.
 *
 * For an account whose only identifier is a public name, recovery can only mean
 * one thing honestly: **you present a secret you were given and kept**. That is
 * what this is. A player who kept their code gets back in unaided; a player who
 * kept nothing has nothing to present, and no design can conjure ownership
 * evidence that was never collected. That second case still ends at a
 * moderator, and the UI says so plainly rather than implying otherwise.
 *
 * ## Why SHA-256 here and scrypt for passwords
 *
 * Passwords are low-entropy and human-chosen, so `player-auth.ts` spends ~100ms
 * of scrypt per verification to make a leaked hash expensive to attack offline.
 * A recovery code is the opposite: {@link RECOVERY_CODE_ENTROPY_BITS} bits
 * drawn from the CSPRNG, with no dictionary to search and no reuse across
 * sites. There is nothing for a slow KDF to slow down, so a single SHA-256 is
 * the appropriate at-rest hash — the same reasoning every API-token store uses.
 * It still means a stolen KV dump yields no usable codes, which is the whole
 * job. The salt is nearly redundant at this entropy and is kept only so the
 * stored form stays non-reusable if the code length is ever reduced.
 */
import crypto from 'crypto';
import { kv } from './_storage.js';
import { safeName } from './_utils.js';

/**
 * Crockford's base32 alphabet: no I, L, O or U.
 *
 * This code gets written on paper and read back over a voice call, so the
 * characters people confuse are simply absent from it rather than left for the
 * reader to disambiguate. `normalizeRecoveryCode` folds the excluded letters
 * back onto the digits they are mistaken for, so a transcription error that
 * writes "O" where the code has "0" still redeems.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters per dash-separated group in the displayed form. */
const GROUP_SIZE = 5;
/** Groups in a code. 4 × 5 = 20 characters. */
const GROUP_COUNT = 4;

/** Total characters in a normalized code. */
export const RECOVERY_CODE_LENGTH = GROUP_SIZE * GROUP_COUNT;

/**
 * 20 base32 characters is 100 bits. Guessing one is not merely rate-limited
 * out, it is arithmetically hopeless — which is why the redemption path can
 * safely skip a per-account attempt lockout (see the note in `player-auth.ts`).
 */
export const RECOVERY_CODE_ENTROPY_BITS = Math.round(RECOVERY_CODE_LENGTH * Math.log2(ALPHABET.length));

/** Storage key for an account's recovery code. One code per account, at most. */
export function recoveryCodeKey(name: string): string {
    return `auth-recovery:${safeName(name)}`;
}

export type RecoveryCodeRecord = {
    /** SHA-256 of `salt + normalized code`, hex. Never the code itself. */
    hash: string;
    salt: string;
    /** When this code was minted, so the UI can say how old it is. */
    issuedAt: number;
};

/**
 * Draw `count` characters from ALPHABET without modulo bias.
 *
 * 256 is not a multiple of 32 only in the sense that it is — 32 divides 256
 * exactly, so masking to the low 5 bits is uniform with no rejection needed.
 * The mask is written out rather than assumed so that changing the alphabet
 * length trips the assertion instead of silently skewing the distribution.
 */
function randomChars(count: number): string {
    if (ALPHABET.length !== 32) throw new Error('recovery-code: alphabet must be 32 characters for unbiased sampling');
    const bytes = crypto.randomBytes(count);
    let out = '';
    for (let i = 0; i < count; i += 1) out += ALPHABET[bytes[i] & 31];
    return out;
}

/** A fresh code in its display form, e.g. `K4M2X-8TQ9B-…`. */
export function generateRecoveryCode(): string {
    const raw = randomChars(RECOVERY_CODE_LENGTH);
    const groups: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i += GROUP_SIZE) groups.push(raw.slice(i, i + GROUP_SIZE));
    return groups.join('-');
}

/**
 * Fold a typed code back to its canonical form, or '' if it cannot be one.
 *
 * Accepts whatever a human produces: lowercase, missing or extra dashes,
 * spaces, and the four ambiguous letters Crockford drops. Anything left over
 * after that is a character the alphabet does not contain, which means this is
 * not a recovery code and there is nothing to look up.
 */
export function normalizeRecoveryCode(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const folded = raw
        .toUpperCase()
        .replace(/[\s-]/g, '')
        .replace(/O/g, '0')
        .replace(/[IL]/g, '1')
        .replace(/U/g, 'V');
    if (folded.length !== RECOVERY_CODE_LENGTH) return '';
    for (const ch of folded) if (!ALPHABET.includes(ch)) return '';
    return folded;
}

function hashCode(code: string, salt: string): string {
    return crypto.createHash('sha256').update(`${salt}${code}`).digest('hex');
}

function timingSafeHexEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length === 0 || ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

/** Build the stored form of a code. Exported for tests; callers use `issueRecoveryCode`. */
export function buildRecoveryCodeRecord(code: string, now: number = Date.now()): RecoveryCodeRecord {
    const salt = crypto.randomBytes(16).toString('hex');
    return { hash: hashCode(normalizeRecoveryCode(code), salt), salt, issuedAt: now };
}

/**
 * True when `supplied` is this account's current recovery code.
 *
 * Fails closed on a missing or malformed record for the same reason
 * `verifyAgainst` does in `player-auth.ts`: "there is no stored credential"
 * must never be reachable from "the supplied one matched".
 */
export function recoveryCodeMatches(record: RecoveryCodeRecord | null | undefined, supplied: unknown): boolean {
    const normalized = normalizeRecoveryCode(supplied);
    if (!normalized) return false;
    if (!record || typeof record.hash !== 'string' || typeof record.salt !== 'string') return false;
    if (!record.hash || !record.salt) return false;
    return timingSafeHexEqual(hashCode(normalized, record.salt), record.hash);
}

/**
 * Mint a new code for `name`, replacing any existing one, and return the
 * plaintext — the only moment it exists outside the caller's own notes.
 *
 * Replacing rather than accumulating is deliberate: a player who asks for a new
 * code usually does so because they suspect the old one is compromised or lost,
 * and "the old one still works" is the wrong answer to both.
 */
export async function issueRecoveryCode(name: string, now: number = Date.now()): Promise<string> {
    const code = generateRecoveryCode();
    await kv.set(recoveryCodeKey(name), buildRecoveryCodeRecord(code, now));
    return code;
}

/** Read the stored record, or null. */
export async function readRecoveryCode(name: string): Promise<RecoveryCodeRecord | null> {
    return await kv.get<RecoveryCodeRecord>(recoveryCodeKey(name));
}

/**
 * Drop an account's recovery code.
 *
 * Every path that frees or re-owns a slug must call this. A recovery record
 * outliving its account is not merely litter: slugs are reusable, so a stale
 * `auth-recovery:<slug>` would hand the *previous* holder of a name a working
 * credential to whoever registers it next.
 */
export async function clearRecoveryCode(name: string): Promise<boolean> {
    return (await kv.del(recoveryCodeKey(name))) > 0;
}
