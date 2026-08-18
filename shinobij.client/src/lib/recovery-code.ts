/*
 * Client-side mirror of the recovery-code format in api/_recovery-code.ts.
 *
 * Only the SHAPE lives here. Nothing on this side decides whether a code is
 * correct — that is a hash comparison the server owns, and the redemption
 * endpoint answers the same way for a wrong code as for a name that does not
 * exist. What this buys is a form that can say "that is not 20 characters"
 * without spending one of a tight rate-limit budget on a typo.
 *
 * `recovery-code.test.ts` reads the API source and asserts the two agree, the
 * same way player-auth-policy.test.ts does for the password policy.
 */

/** Crockford base32: no I, L, O or U, so nothing has to be disambiguated by eye. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const RECOVERY_CODE_LENGTH = 20;
const GROUP_SIZE = 5;

/**
 * Fold a typed code to the canonical form the server hashes, or "" if it
 * cannot be one.
 *
 * Accepts lowercase, missing or extra dashes, spaces, and the four letters the
 * alphabet drops — someone reading a code off paper writes O for 0 and l for 1,
 * and there is no reason to make that a failed attempt.
 */
export function normalizeRecoveryCode(raw: unknown): string {
    if (typeof raw !== "string") return "";
    const folded = raw
        .toUpperCase()
        .replace(/[\s-]/g, "")
        .replace(/O/g, "0")
        .replace(/[IL]/g, "1")
        .replace(/U/g, "V");
    if (folded.length !== RECOVERY_CODE_LENGTH) return "";
    for (const ch of folded) if (!ALPHABET.includes(ch)) return "";
    return folded;
}

/** Re-group a normalized code for display: `XXXXX-XXXXX-XXXXX-XXXXX`. */
export function formatRecoveryCode(normalized: string): string {
    const groups: string[] = [];
    for (let i = 0; i < normalized.length; i += GROUP_SIZE) groups.push(normalized.slice(i, i + GROUP_SIZE));
    return groups.join("-");
}

/**
 * Reformat as the player types, so the field always looks like the code on
 * their paper. Deliberately tolerant of a half-typed value — this runs on every
 * keystroke, and a field that erases what you typed because it is not yet
 * complete is worse than no help at all.
 */
export function formatRecoveryCodeInput(raw: string): string {
    const cleaned = raw
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, "")
        .slice(0, RECOVERY_CODE_LENGTH);
    return formatRecoveryCode(cleaned);
}

/** Shape-only check. A true answer does not mean the code is the right one. */
export function looksLikeRecoveryCode(raw: unknown): boolean {
    return normalizeRecoveryCode(raw) !== "";
}
