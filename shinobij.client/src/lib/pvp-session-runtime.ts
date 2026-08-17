import type { PvpSessionState } from "../types/pvp-ui";

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, Math.max(0, ms));
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

const RANKED_SESSION_TOMBSTONES = new Set([
    "player-ranked-session-close-tombstone-v1",
    "player-ranked-session-orphan-tombstone-v1",
]);

type PvpSessionParseResult =
    | { kind: "session"; session: PvpSessionState }
    | { kind: "terminal"; message: string }
    | { kind: "invalid"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export function splitPvpMoveResponse(raw: unknown): {
    projection: unknown;
    rejected?: PvpSessionState["rejected"];
} {
    if (!isRecord(raw)) return { projection: raw };
    const candidate = raw.rejected;
    const rejected = isRecord(candidate)
        && candidate.applied === false
        && typeof candidate.reason === "string"
        && candidate.reason.trim()
        && isNonNegativeInteger(candidate.serverRound)
        && (candidate.activePlayer === "p1" || candidate.activePlayer === "p2")
        ? candidate as PvpSessionState["rejected"]
        : undefined;
    if (candidate === undefined) return { projection: raw };
    const projection = { ...raw };
    delete projection.rejected;
    return { projection, rejected };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFighter(value: unknown): boolean {
    if (!isRecord(value)
        || typeof value.name !== "string"
        || !value.name.trim()
        || !isFiniteNumber(value.hp)
        || !isFiniteNumber(value.maxHp)
        || !isFiniteNumber(value.chakra)
        || !isFiniteNumber(value.maxChakra)
        || !isFiniteNumber(value.stamina)
        || !isFiniteNumber(value.maxStamina)
        || !isFiniteNumber(value.shield)
        || !isNonNegativeInteger(value.pos)
        || !isRecord(value.character)
        || !Array.isArray(value.statuses)) return false;
    return value.statuses.every((status) => isRecord(status)
        && typeof status.name === "string"
        && isFiniteNumber(status.rounds)
        && (status.kind === "positive" || status.kind === "negative"));
}

function isCooldownProjection(value: unknown): boolean {
    if (!isRecord(value) || !isRecord(value.p1) || !isRecord(value.p2)) return false;
    return [value.p1, value.p2].every((side) => Object.values(side).every(isFiniteNumber));
}

function hasSafeOptionalArray(record: Record<string, unknown>, key: string): boolean {
    return record[key] === undefined || Array.isArray(record[key]);
}

function hasRankedCloseFence(record: Record<string, unknown>): boolean {
    const fence = record.rankedCloseFence;
    return record.status === "active"
        && record.playerRankedAuthorityVersion === 2
        && record.rankedKind === "player"
        && isRecord(fence)
        && fence.version === "player-ranked-session-close-fence-v1"
        && fence.matchId === record.rankedMatchId
        && fence.seasonId === record.rankedSeasonId
        && fence.seasonEpoch === record.rankedSeasonEpoch
        && typeof fence.transitionId === "string"
        && fence.transitionId.length > 0
        && Number.isSafeInteger(fence.fencedAt)
        && Number(fence.fencedAt) > 0;
}

/**
 * Parse the untrusted Realtime/SSE/HTTP projection before it reaches render
 * code. Ranked close/orphan tombstones are terminal control records, not battle
 * sessions. A pre-deploy row with no revision is projected as revision 0; its
 * first server mutation advances to 1. An explicit zero/invalid revision still
 * fails closed.
 */
export function parsePvpSessionProjection(raw: unknown, expectedBattleId: string): PvpSessionParseResult {
    if (!isRecord(raw)) return { kind: "invalid", message: "The battle service returned an invalid session." };
    if (raw.battleId !== expectedBattleId) {
        return { kind: "invalid", message: "The battle service returned a mismatched session." };
    }
    if ((typeof raw.version === "string" && RANKED_SESSION_TOMBSTONES.has(raw.version))
        || hasRankedCloseFence(raw)) {
        return { kind: "terminal", message: "This ranked battle ended as a no-contest." };
    }
    const legacyUnrevisioned = raw.stateRevision === undefined;
    if ((!legacyUnrevisioned && (!Number.isSafeInteger(raw.stateRevision) || Number(raw.stateRevision) <= 0))
        || !isFighter(raw.p1)
        || !isFighter(raw.p2)
        || !isNonNegativeInteger(raw.round)
        || (raw.activePlayer !== "p1" && raw.activePlayer !== "p2")
        || !isRecord(raw.ap)
        || !isFiniteNumber(raw.ap.p1)
        || !isFiniteNumber(raw.ap.p2)
        || !isNonNegativeInteger(raw.actionsThisTurn)
        || !isCooldownProjection(raw.cooldowns)
        || !Array.isArray(raw.log)
        || !raw.log.every((line) => typeof line === "string")
        || (raw.status !== "active" && raw.status !== "done")
        || ![null, "p1", "p2", "draw"].includes(raw.winner as null | string)
        || !hasSafeOptionalArray(raw, "groundEffects")
        || !hasSafeOptionalArray(raw, "fx")
        || !hasSafeOptionalArray(raw, "vfx")) {
        return { kind: "invalid", message: "The battle service returned an invalid session." };
    }
    const session = legacyUnrevisioned ? { ...raw, stateRevision: 0 } : raw;
    return { kind: "session", session: session as unknown as PvpSessionState };
}

export type PvpRevisionDecision = "accept" | "duplicate" | "stale" | "foreign" | "conflict";

/** Accept only a strictly newer projection for this exact battle. */
export function decidePvpSessionRevision(
    current: PvpSessionState | null,
    incoming: PvpSessionState,
): PvpRevisionDecision {
    if (current && current.battleId !== incoming.battleId) return "foreign";
    if (!current) return "accept";
    if (incoming.stateRevision > current.stateRevision) return "accept";
    if (incoming.stateRevision === current.stateRevision) {
        if (JSON.stringify(incoming) === JSON.stringify(current)) return "duplicate";
        // Rolling deploy: an old move worker may terminalize an unrevisioned
        // row without adding stateRevision. Never freeze that decisive legacy
        // transition behind equal synthetic revision zero.
        if (incoming.stateRevision === 0 && current.status === "active" && incoming.status === "done") {
            return "accept";
        }
        return "conflict";
    }
    return "stale";
}

type InitialPvpResponse = {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
};

export type InitialPvpProjectionResult =
    | { kind: "session"; session: PvpSessionState }
    | { kind: "terminal"; message: string }
    | { kind: "missing"; message: string }
    | { kind: "unavailable"; message: string; seedMayRemainVisible: boolean }
    | { kind: "aborted" };

/**
 * Perform the mount-time authority read. A matching seed improves first paint
 * but never suppresses this GET: Realtime does not replay a delete/tombstone.
 * A creation/publication race may expose an initial 404, so absence is accepted
 * only after a small bounded retry window; 409 is an immediate no-contest.
 */
export async function fetchInitialPvpProjection(options: {
    battleId: string;
    fetchSession: (input: string, init: { signal?: AbortSignal }) => Promise<InitialPvpResponse>;
    signal?: AbortSignal;
    isActive?: () => boolean;
    attempts?: number;
    wait?: (ms: number) => Promise<void>;
}): Promise<InitialPvpProjectionResult> {
    const maxAttempts = Math.max(1, Math.floor(options.attempts ?? 5));
    const isActive = options.isActive ?? (() => true);
    const wait = options.wait ?? ((ms: number) => abortableDelay(ms, options.signal));
    let lastStatus = 0;
    let sawInvalidProjection = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0) {
            try {
                await wait(350 * attempt);
            } catch (error) {
                if (options.signal?.aborted) return { kind: "aborted" };
                throw error;
            }
        }
        if (!isActive() || options.signal?.aborted) return { kind: "aborted" };
        try {
            const response = await options.fetchSession(
                `/api/pvp/session?id=${encodeURIComponent(options.battleId)}`,
                options.signal ? { signal: options.signal } : {},
            );
            lastStatus = response.status;
            if (response.status === 409) {
                return { kind: "terminal", message: "This ranked battle ended as a no-contest." };
            }
            if (response.ok) {
                const parsed = parsePvpSessionProjection(await response.json(), options.battleId);
                if (parsed.kind === "session") return parsed;
                if (parsed.kind === "terminal") return parsed;
                sawInvalidProjection = true;
                continue;
            }
            // A session POST and the first GET can cross during publication.
            // Retry every 404; only the exhausted series proves bounded absence.
            if (response.status === 404) continue;
            if (response.status === 403) {
                return {
                    kind: "unavailable",
                    message: "You are not allowed to open this battle session.",
                    seedMayRemainVisible: false,
                };
            }
        } catch {
            if (!isActive() || options.signal?.aborted) return { kind: "aborted" };
        }
    }

    if (lastStatus === 404) {
        return { kind: "missing", message: "The battle session is unavailable or expired." };
    }
    if (sawInvalidProjection) {
        return {
            kind: "unavailable",
            message: "The battle service returned an invalid session.",
            seedMayRemainVisible: false,
        };
    }
    return {
        kind: "unavailable",
        message: "The battle service is temporarily unavailable.",
        seedMayRemainVisible: true,
    };
}

export type PvpContinuationFence = ReturnType<typeof createPvpContinuationFence>;

/**
 * Captures whether an async continuation still belongs to the mounted account
 * + battle scope. `activate` deliberately advances the generation even for an
 * identical scope so React Strict Mode's setup-cleanup-setup cycle cannot
 * revive continuations from the discarded setup.
 */
export function createPvpContinuationFence() {
    let scopeKey = "";
    let generation = 0;
    let active = false;
    return {
        activate(nextScopeKey: string): void {
            scopeKey = nextScopeKey;
            generation += 1;
            active = true;
        },
        capture(): () => boolean {
            const capturedScope = scopeKey;
            const capturedGeneration = generation;
            return () => active
                && scopeKey === capturedScope
                && generation === capturedGeneration;
        },
        invalidate(): void {
            generation += 1;
            active = false;
        },
    };
}

export function pvpRuntimeScopeKey(
    accountName: string,
    accountSessionEpoch: number,
    battleId: string,
    role: "p1" | "p2",
): string {
    return `${accountName.trim().toLowerCase()}\u0000${accountSessionEpoch}\u0000${battleId}\u0000${role}`;
}
