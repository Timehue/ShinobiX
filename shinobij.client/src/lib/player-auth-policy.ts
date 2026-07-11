export const PLAYER_PASSWORD_MIN_LENGTH = 8;
export const PLAYER_PASSWORD_MAX_LENGTH = 128;

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
    ban?: { until: number; reason: string; permanent?: boolean };
};

/** A legacy save with no credential must only be recovered by an admin. */
export function requiresLegacyAdminRecovery(status: number, body: unknown): boolean {
    if (status !== 409 || !body || typeof body !== "object" || Array.isArray(body)) return false;
    const response = body as PlayerAuthResponse;
    return response.legacy === true || response.legacyNeedsAdmin === true;
}
