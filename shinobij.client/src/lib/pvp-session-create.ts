import type { PvpSessionState } from "../types/pvp-ui";
import { decidePvpCreateRecovery, type PendingPvpRecovery } from "./pvp-pending-session";
import { fetchPendingPvpRecovery } from "./pvp-pending-fetch";
import { abortableDelay, parsePvpSessionProjection } from "./pvp-session-runtime";

export type PvpSessionCreateRecoveryResult =
    | { kind: "created"; battleId: string; session: PvpSessionState; canonicalResume?: boolean }
    | { kind: "recovered"; pending: PendingPvpRecovery }
    | { kind: "ambiguous"; battleId: string; error: string }
    | { kind: "rejected"; error: string };

export function pvpStableBattleIdFromRequestBody(requestBody: string): string {
    try {
        const parsed = JSON.parse(requestBody) as { battleId?: unknown };
        return typeof parsed.battleId === "string" ? parsed.battleId.trim() : "";
    } catch {
        return "";
    }
}

function abortError(): DOMException {
    return new DOMException("PvP session creation was aborted.", "AbortError");
}

function safePlayer(value: unknown): string {
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function canonicalClanResumeMatches(
    requestBody: string,
    playerName: string,
    session: PvpSessionState,
): boolean {
    try {
        const request = JSON.parse(requestBody) as Record<string, unknown>;
        const p1Request = request.p1Character as Record<string, unknown> | undefined;
        const p2Request = request.p2Character as Record<string, unknown> | undefined;
        const p1 = safePlayer(session.p1?.name);
        const p2 = safePlayer(session.p2?.name);
        return session.rewardAuthority === "clan-war"
            && typeof request.clanWarId === "string"
            && typeof request.clanWarChallengeId === "string"
            && session.clanWarId === request.clanWarId
            && session.clanWarChallengeId === request.clanWarChallengeId
            && p1 === safePlayer(p1Request?.name)
            && p2 === safePlayer(p2Request?.name)
            && (safePlayer(playerName) === p1 || safePlayer(playerName) === p2);
    } catch {
        return false;
    }
}

/**
 * Publish one stable PvP create intent, then recover the authenticated
 * single-flight pointer before any caller is allowed to discard the battle.
 * Every retry reuses the exact request body/battle id.
 */
export async function createPvpSessionWithRecovery(
    fetchFn: typeof fetch,
    playerName: string,
    requestBody: string,
    options: {
        signal?: AbortSignal;
        isCurrent?: () => boolean;
        attempts?: number;
        wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
        requestTimeoutMs?: number;
    } = {},
): Promise<PvpSessionCreateRecoveryResult> {
    const stableBattleId = pvpStableBattleIdFromRequestBody(requestBody);
    if (!stableBattleId) return { kind: "rejected", error: "PvP create intent is missing its stable battle id." };
    const isCurrent = options.isCurrent ?? (() => true);
    const wait = options.wait ?? abortableDelay;
    const attempts = Math.max(1, Math.min(5, Math.floor(options.attempts ?? 4)));
    const requestTimeoutMs = Math.max(10, Math.min(15_000, Math.floor(options.requestTimeoutMs ?? 8_000)));
    let ambiguous = false;
    let conclusiveRejection = false;
    let lastError = "Could not create the authoritative PvP battle.";

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (options.signal?.aborted || !isCurrent()) throw abortError();
        if (attempt > 0) await wait(300 * attempt, options.signal);
        if (options.signal?.aborted || !isCurrent()) throw abortError();
        try {
            const requestTimeout = AbortSignal.timeout(requestTimeoutMs);
            const requestSignal = options.signal
                ? AbortSignal.any([options.signal, requestTimeout])
                : requestTimeout;
            const response = await fetchFn("/api/pvp/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: requestBody,
                signal: requestSignal,
            });
            if (options.signal?.aborted || !isCurrent()) throw abortError();
            const body = await response.json().catch(() => null) as {
                battleId?: unknown;
                session?: unknown;
                error?: unknown;
                canonicalResume?: unknown;
            } | null;
            if (options.signal?.aborted || !isCurrent()) throw abortError();
            if (response.ok) {
                const returnedBattleId = typeof body?.battleId === "string" ? body.battleId.trim() : "";
                const parsed = returnedBattleId && body?.session
                    ? parsePvpSessionProjection(body.session, returnedBattleId)
                    : { kind: "invalid" as const };
                if (returnedBattleId === stableBattleId && parsed.kind === "session") {
                    return { kind: "created", battleId: returnedBattleId, session: parsed.session };
                }
                if (body?.canonicalResume === true
                    && returnedBattleId !== stableBattleId
                    && parsed.kind === "session"
                    && canonicalClanResumeMatches(requestBody, playerName, parsed.session)) {
                    return {
                        kind: "created",
                        battleId: returnedBattleId,
                        session: parsed.session,
                        canonicalResume: true,
                    };
                }
                ambiguous = true;
                lastError = "The battle server returned an incomplete create acknowledgement.";
                continue;
            }
            lastError = typeof body?.error === "string" && body.error.trim()
                ? body.error.trim()
                : `PvP session create failed (HTTP ${response.status}).`;
            if (response.status === 409 || response.status >= 500) {
                ambiguous = true;
                continue;
            }
            conclusiveRejection = true;
            break;
        } catch (error) {
            if (options.signal?.aborted || !isCurrent()) {
                throw abortError();
            }
            ambiguous = true;
            lastError = error instanceof Error && error.message ? error.message : lastError;
        }
    }

    if (options.signal?.aborted || !isCurrent()) throw abortError();
    let pending: PendingPvpRecovery | null = null;
    let recoveryChecked = false;
    try {
        const pendingTimeout = AbortSignal.timeout(requestTimeoutMs);
        const pendingSignal = options.signal
            ? AbortSignal.any([options.signal, pendingTimeout])
            : pendingTimeout;
        const found = await fetchPendingPvpRecovery(fetchFn, playerName, { signal: pendingSignal });
        if (options.signal?.aborted || !isCurrent()) throw abortError();
        pending = found;
        recoveryChecked = true;
    } catch {
        if (options.signal?.aborted || !isCurrent()) {
            throw abortError();
        }
    }
    if (pending?.battleId === stableBattleId) {
        return { kind: "created", battleId: stableBattleId, session: pending.session };
    }
    // One owner for the three-way branch: adopt a published pointer, else keep
    // the stable id discoverable, else clear. An unchecked (offline) lookup is
    // never conclusive, so it can only retain the stable id.
    const decision = decidePvpCreateRecovery({
        pending,
        createRejected: conclusiveRejection && !ambiguous,
        recoveryChecked,
        stableBattleId,
    });
    if (decision.kind === "pending") return { kind: "recovered", pending: decision.pending };
    if (decision.kind === "stable-id") {
        return { kind: "ambiguous", battleId: decision.battleId, error: lastError };
    }
    return { kind: "rejected", error: lastError };
}
