// Server-authoritative queueing for a won combat mission, plus the
// account-deletion request pair. Both were inline in App.tsx; they live here so
// the settlement logic is testable and App.tsx keeps draining.

import type { Character } from '../types/character';

export type CombatMissionQueueDisposition = "accepted" | "terminal" | "retryable";

export type CombatMissionQueueResult = {
    queued: boolean;
    disposition: CombatMissionQueueDisposition;
    reason?: string;
    character?: Character;
    _saveVersion?: number;
    saveVersion?: number;
    httpStatus?: number;
};

// Only decisions that prove this exact run can never become claim authority are
// safe to retire from the durable outbox. Capacity/auth/conflict/server states
// remain parked and can recover after the surrounding condition changes.
const DEFINITIVE_QUEUE_REASONS = new Set([
    "unknown-mission",
    "server_authoritative_combat_required",
    "invalid-binding",
    "wrong-player",
    "wrong-mission",
    "wrong-run",
    "expired",
    "not-won",
    "not-a-member",
    "reward-drift",
]);

export function isAuthoritativeCombatMissionCharacter(value: unknown): value is Character {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.name === "string" && candidate.name.length > 0
        && Number.isFinite(candidate.level) && Number(candidate.level) >= 1
        && Number.isFinite(candidate.ryo) && Number(candidate.ryo) >= 0
        && Array.isArray(candidate.inventory);
}

function queueDecision(
    playerName: string,
    data: { queued?: unknown; reason?: unknown; character?: unknown; _saveVersion?: unknown } | null,
): CombatMissionQueueResult {
    if (!data || typeof data.queued !== "boolean") {
        return { queued: false, disposition: "retryable", reason: "invalid-server-response" };
    }
    const reason = typeof data.reason === "string" ? data.reason : undefined;
    if (!data.queued) {
        return {
            queued: false,
            disposition: reason && DEFINITIVE_QUEUE_REASONS.has(reason) ? "terminal" : "retryable",
            reason: reason ?? "queue-not-confirmed",
        };
    }
    const version = typeof data._saveVersion === "number"
        && Number.isSafeInteger(data._saveVersion)
        && data._saveVersion >= 0
        ? data._saveVersion
        : undefined;
    const character = isAuthoritativeCombatMissionCharacter(data.character)
        ? data.character
        : undefined;
    if (!character
        || character.name.toLowerCase() !== playerName.toLowerCase()
        || version === undefined) {
        // The queue may have committed, but adopting or retiring without its
        // authoritative snapshot would leave the client on a stale save base.
        // Keep the run parked; the idempotent replay returns the full snapshot.
        return { queued: false, disposition: "retryable", reason: "authoritative-snapshot-missing" };
    }
    return {
        queued: true,
        disposition: "accepted",
        character,
        _saveVersion: version,
        saveVersion: version,
    };
}

/**
 * Queue the server-side claim for a won combat mission.
 *
 * This is NOT optional bookkeeping: /api/missions/claim-mission rejects the
 * later payout with `not-queued` unless this call minted its durable claim
 * run-bound token, and the local pendingCombatMissionClaims flag can never
 * promote itself into one. The original call site fired this and swallowed
 * every error, which
 * left the player looking at a "Claim Reward" button that could only ever fail.
 *
 * Retries transient failures with backoff. Auth, rate, conflict, network, and
 * server outcomes remain explicitly retryable; only a validated success or a
 * small allowlist of run-invalidating decisions is definitive.
 */
export async function queueCombatMissionClaim(
    playerName: string,
    missionId: string,
    runId: string,
    attempts = 4,
): Promise<CombatMissionQueueResult> {
    if (!runId) return { queued: false, disposition: "terminal", reason: "missing-run-authority" };
    let latestFailure: CombatMissionQueueResult = {
        queued: false,
        disposition: "retryable",
        reason: "network-error",
    };
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const res = await fetch("/api/missions/queue-combat-claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName, missionId, runId }),
            });
            if (res.ok) {
                const data = await res.json().catch(() => null) as {
                    queued?: unknown;
                    reason?: unknown;
                    character?: unknown;
                    _saveVersion?: unknown;
                } | null;
                const decision = queueDecision(playerName, data);
                if (decision.disposition !== "retryable") return decision;
                latestFailure = decision;
            }
            if (!res.ok) {
                const category = res.status === 401 || res.status === 403
                    ? "auth"
                    : res.status === 429
                        ? "rate-limit"
                        : res.status === 409
                            ? "conflict"
                            : res.status >= 500 || res.status === 404
                                ? "server"
                                : "http";
                latestFailure = {
                    queued: false,
                    disposition: "retryable",
                    reason: `${category}-${res.status}`,
                    httpStatus: res.status,
                };
            }
        } catch { /* network — fall through to the backoff */ }
        if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
    }
    return latestFailure;
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
