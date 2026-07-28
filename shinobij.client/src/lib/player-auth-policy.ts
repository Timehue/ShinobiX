export const PLAYER_PASSWORD_MIN_LENGTH = 8;
export const PLAYER_PASSWORD_MAX_LENGTH = 128;

export const PLAYER_NAME_MIN_LENGTH = 3;
/** Mirrors api/_text-moderation.ts TEXT_LIMITS.playerName and safeName's key cap. */
export const PLAYER_NAME_MAX_LENGTH = 32;

/**
 * Display-name policy, shared by the character creator and the registration API.
 *
 * The upper bound existed nowhere before: no `maxLength` on the input, no ceiling in
 * client validation, no check at registration, and no clamp in the save sanitizer —
 * only the derived KV-key slug was truncated. Because a display name is rendered in
 * OTHER players' UI (leaderboards, sector nameplates, chat, clan rosters), an
 * unbounded one breaks layout for everybody except the person who chose it.
 */
export function playerNamePolicyError(name: unknown): string | null {
    if (typeof name !== "string") return "Name must be text.";
    const trimmed = name.trim();
    if (trimmed.length < PLAYER_NAME_MIN_LENGTH) {
        return `Pick a shinobi name with at least ${PLAYER_NAME_MIN_LENGTH} characters.`;
    }
    if (trimmed.length > PLAYER_NAME_MAX_LENGTH) {
        return `Names are at most ${PLAYER_NAME_MAX_LENGTH} characters.`;
    }
    return null;
}

/** Keep client and local-dev validation aligned with the production API. */
export function playerPasswordPolicyError(password: unknown): string | null {
    if (typeof password !== "string") return "Password must be text.";
    if (password.length < PLAYER_PASSWORD_MIN_LENGTH) {
        return `Password must be at least ${PLAYER_PASSWORD_MIN_LENGTH} characters.`;
    }
    if (password.length > PLAYER_PASSWORD_MAX_LENGTH) {
        return `Password must be at most ${PLAYER_PASSWORD_MAX_LENGTH} characters.`;
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        return "Password must include at least one letter and one number.";
    }
    return null;
}

export type PlayerAuthResponse = {
    ok?: boolean;
    error?: string;
    token?: string;
    legacy?: boolean;
    legacyNeedsAdmin?: boolean;
    unused?: boolean;
    retryAfterMs?: number;
    ban?: { until: number; reason: string; permanent?: boolean };
};

/** A legacy save with no credential must only be recovered by an admin. */
export function requiresLegacyAdminRecovery(status: number, body: unknown): boolean {
    if (status !== 409 || !body || typeof body !== "object" || Array.isArray(body)) return false;
    const response = body as PlayerAuthResponse;
    return response.legacy === true || response.legacyNeedsAdmin === true;
}

/**
 * Message for an HTTP 429 from /api/player-auth.
 *
 * The auth limiter is keyed on IP, so this fires for everyone behind one
 * connection — a household, a dorm, a campus, or anything behind carrier-grade
 * NAT. Login used to report 429 with the same "Player name or password is
 * incorrect" alert as a genuine credential failure, which told a group of friends
 * signing up together that their passwords were wrong and gave them no reason to
 * simply wait. Name the real cause and give a concrete wait time.
 */
export function authRateLimitMessage(body: unknown): string {
    const retryAfterMs = (body as PlayerAuthResponse | null)?.retryAfterMs;
    const minutes = typeof retryAfterMs === "number" && retryAfterMs > 0
        ? Math.max(1, Math.ceil(retryAfterMs / 60_000))
        : null;
    const wait = minutes === null
        ? "Please wait a few minutes and try again."
        : `Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    return "Too many sign-in attempts from your network.\n\n"
        + "This limit counts everyone on the same internet connection, so it can trigger "
        + `when several people sign in together. Your password is fine. ${wait}`;
}
