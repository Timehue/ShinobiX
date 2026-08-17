import type { PvpSessionState } from "../types/pvp-ui";
import { abortableDelay, parsePvpSessionProjection } from "./pvp-session-runtime";
import type { PendingPvpRecovery, PvpRecoveryContext } from "./pvp-pending-session";

// Split out of pvp-pending-session so the startup graph does not carry PvP
// network recovery. App boots by reading a localStorage breadcrumb, which is
// synchronous and stays there; everything here is awaited from a lazy path
// (session create, the PvP screen, or App's fire-and-forget recovery probe).
export function contextFromPendingPvpSession(
    session: PvpSessionState,
    role: "p1" | "p2",
): PvpRecoveryContext {
    const sectorAttack = session.rewardAuthority === "world" && !!session.worldAttacker;
    return {
        mode: session.clanWarChallengeId
            ? "clanWar1v1"
            : session.ranked || session.playerRankedAuthorityVersion === 2
                ? "ranked"
                : "standard",
        ...(sectorAttack ? {
            sectorAttack: true,
            raidKind: session.worldAttacker?.side === role ? "raidPlayer" : "defense",
        } : {}),
        ...(Number.isFinite(Number(session.rewardSector))
            ? { sector: Math.floor(Number(session.rewardSector)) }
            : {}),
        ...(session.clanWarChallengeId
            ? { clanWarChallengeId: session.clanWarChallengeId }
            : {}),
    };
}

export async function fetchPendingPvpRecovery(
    fetchFn: typeof fetch,
    playerName: string,
    options: { signal?: AbortSignal } = {},
): Promise<PendingPvpRecovery | null> {
    const response = await fetchFn(
        `/api/pvp/session?pending=1&playerName=${encodeURIComponent(playerName)}`,
        { cache: "no-store", signal: options.signal },
    );
    if (response.status === 404 || response.status === 409) return null;
    if (!response.ok) throw new Error(`Pending PvP recovery failed (HTTP ${response.status}).`);
    const body = await response.json() as Partial<PendingPvpRecovery>;
    if (typeof body.battleId !== "string"
        || !body.battleId.trim()
        || (body.role !== "p1" && body.role !== "p2")
        || !body.session) {
        throw new Error("Pending PvP recovery returned malformed authority.");
    }
    const parsed = parsePvpSessionProjection(body.session, body.battleId);
    if (parsed.kind !== "session") {
        throw new Error("Pending PvP recovery returned malformed authority.");
    }
    return {
        battleId: body.battleId,
        role: body.role,
        session: parsed.session,
        context: contextFromPendingPvpSession(parsed.session, body.role),
    };
}

/** Bounded boot/private-mode discovery across pointer publication races. */
export async function fetchPendingPvpRecoveryWithRetry(
    fetchFn: typeof fetch,
    playerName: string,
    options: {
        signal?: AbortSignal;
        isCurrent?: () => boolean;
        attempts?: number;
        wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
        requestTimeoutMs?: number;
    } = {},
): Promise<PendingPvpRecovery | null> {
    const attempts = Math.max(1, Math.min(6, Math.floor(options.attempts ?? 5)));
    const isCurrent = options.isCurrent ?? (() => true);
    const wait = options.wait ?? abortableDelay;
    const requestTimeoutMs = Math.max(10, Math.min(15_000, Math.floor(options.requestTimeoutMs ?? 8_000)));
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (options.signal?.aborted || !isCurrent()) throw new DOMException("Aborted", "AbortError");
        if (attempt > 0) await wait(350 * attempt, options.signal);
        if (options.signal?.aborted || !isCurrent()) throw new DOMException("Aborted", "AbortError");
        try {
            const requestTimeout = AbortSignal.timeout(requestTimeoutMs);
            const requestSignal = options.signal
                ? AbortSignal.any([options.signal, requestTimeout])
                : requestTimeout;
            const pending = await fetchPendingPvpRecovery(fetchFn, playerName, { signal: requestSignal });
            if (options.signal?.aborted || !isCurrent()) throw new DOMException("Aborted", "AbortError");
            if (pending) return pending;
            lastError = null;
        } catch (error) {
            if (options.signal?.aborted || !isCurrent()) throw new DOMException("Aborted", "AbortError");
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return null;
}
