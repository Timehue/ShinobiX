// Server-authoritative queueing for a won E/D combat mission, plus the
// account-deletion request pair. Both were inline in App.tsx; they live here so
// the settlement logic is testable and App.tsx keeps draining.

/**
 * Queue the server-side claim for a won combat mission.
 *
 * This is NOT optional bookkeeping: /api/missions/claim-mission rejects the
 * later payout with `not-queued` unless this call minted its durable claim
 * token, and the local pendingCombatMissionClaims flag can never promote itself
 * into one. The original call site fired this and swallowed every error, which
 * left the player looking at a "Claim Reward" button that could only ever fail.
 *
 * Retries transient failures with backoff; a 4xx is a decision, not a hiccup, so
 * it stops immediately. Resolves with the new `_saveVersion` on success (the
 * caller advances its optimistic-concurrency base) or null on failure.
 */
export async function queueCombatMissionClaim(
    playerName: string,
    missionId: string,
    attempts = 4,
): Promise<{ saveVersion?: number } | null> {
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const res = await fetch("/api/missions/queue-combat-claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName, missionId }),
            });
            if (res.ok) {
                const data = await res.json().catch(() => null) as { _saveVersion?: number } | null;
                return { saveVersion: typeof data?._saveVersion === "number" ? data._saveVersion : undefined };
            }
            if (res.status < 500) break;
        } catch { /* network — fall through to the backoff */ }
        if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
    }
    return null;
}

/** Player-facing copy for each way deleteServerAccount can fail. */
export const DELETE_ACCOUNT_ERRORS = {
    auth: "That password was rejected. Your character was NOT deleted.",
    network: "Couldn't reach the server. Your character was NOT deleted — check your connection and try again.",
    server: "The server could not fully delete this character, so nothing was removed. Try again in a moment.",
} as const;

export type AccountDeletionResult =
    | { ok: true }
    | { ok: false; reason: "auth" | "server" | "network" };

/**
 * Delete a player's save AND their auth record.
 *
 * Both must succeed before the caller forgets the account locally. If the save
 * is deleted but the auth record survives — or either request fails and the
 * local entry is cleared anyway — the player re-creates the same name and hits a
 * 409 "already exists" against an auth record they can no longer reach. A 404 on
 * either half is success: that half was already gone.
 */
export async function deleteServerAccount(accountName: string, password: string): Promise<AccountDeletionResult> {
    const slug = accountName.toLowerCase();
    try {
        const [saveRes, authRes] = await Promise.all([
            fetch(`/api/save/${encodeURIComponent(slug)}`, {
                method: "DELETE",
                headers: password ? { "x-player-password": password } : {},
            }),
            fetch("/api/player-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(password ? { "x-player-password": password } : {}) },
                body: JSON.stringify({ action: "delete", name: slug, password }),
            }),
        ]);
        const settled = (r: Response) => r.ok || r.status === 404;
        if (settled(saveRes) && settled(authRes)) return { ok: true };
        if (saveRes.status === 401 || authRes.status === 401) return { ok: false, reason: "auth" };
        return { ok: false, reason: "server" };
    } catch {
        return { ok: false, reason: "network" };
    }
}
