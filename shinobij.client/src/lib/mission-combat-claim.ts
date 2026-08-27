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

export const DELETE_ACCOUNT_ERRORS = {
    auth: "Your sign-in could not be verified. Your character was NOT deleted.",
    network: "Couldn't reach the server. Your character was NOT deleted — check your connection and try again.",
    server: "The server could not fully delete this character. Try again in a moment to finish the deletion.",
} as const;

export type AccountDeletionResult =
    | { ok: true }
    | { ok: false; reason: "auth" | "server" | "network" };

export async function deleteServerAccount(accountName: string, password = ""): Promise<AccountDeletionResult> {
    const slug = accountName.toLowerCase();
    const passwordHeaders: Record<string, string> = password ? { "x-player-password": password } : {};
    const rejected = (response: Response) => response.status === 401 || response.status === 403;
    const settled = (response: Response) => response.ok || response.status === 404;
    try {
        // Delete the save before revoking the auth record. In the token path,
        // firing these requests in parallel allowed auth deletion to rotate the
        // session epoch while save deletion was still authenticating, producing
        // an intermittent 401 and leaving the character behind. A partial server
        // failure remains safely retryable: a missing save/auth record is settled.
        const saveRes = await fetch(`/api/save/${encodeURIComponent(slug)}`, {
            method: "DELETE",
            headers: passwordHeaders,
        });
        if (!settled(saveRes)) return { ok: false, reason: rejected(saveRes) ? "auth" : "server" };

        const authRes = await fetch("/api/player-auth", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...passwordHeaders },
            body: JSON.stringify({ action: "delete", name: slug, ...(password ? { password } : {}) }),
        });
        if (settled(authRes)) return { ok: true };
        return { ok: false, reason: rejected(authRes) ? "auth" : "server" };
    } catch {
        return { ok: false, reason: "network" };
    }
}
