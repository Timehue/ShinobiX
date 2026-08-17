import type { PvpSessionState } from "../types/pvp-ui";
import { abortableDelay, parsePvpSessionProjection } from "./pvp-session-runtime";

export const PVP_BROWSER_RECOVERY_TTL_MS = 48 * 60 * 60 * 1000;

export type PvpRecoveryContext = {
    mode?: "standard" | "ranked" | "clanWar1v1" | "clanWar2v2" | "clanWarPet" | "rankedPet";
    clanWarPoints?: number;
    sectorAttack?: boolean;
    raidKind?: "raidPlayer" | "defense";
    sector?: number;
    clanWarChallengeId?: string;
    kageChallengeId?: string;
    kageVillage?: string;
};

export type PvpBrowserBreadcrumb = {
    owner: string;
    pvpBattleId: string;
    pvpRole?: "p1" | "p2";
    pvpBattleContext?: PvpRecoveryContext;
    savedAt: number;
};

export type PendingPvpRecovery = {
    battleId: string;
    role: "p1" | "p2";
    session: PvpSessionState;
    context: PvpRecoveryContext;
};

export type PvpCreateRecoveryDecision =
    | { kind: "pending"; pending: PendingPvpRecovery }
    | { kind: "stable-id"; battleId: string }
    | { kind: "clear" };

/** Keep ambiguous create publication discoverable in the current mount. */
export function decidePvpCreateRecovery(args: {
    pending: PendingPvpRecovery | null;
    createRejected: boolean;
    recoveryChecked: boolean;
    stableBattleId: string;
}): PvpCreateRecoveryDecision {
    if (args.pending) return { kind: "pending", pending: args.pending };
    const battleId = args.stableBattleId.trim();
    if ((!args.createRejected || !args.recoveryChecked) && battleId) {
        return { kind: "stable-id", battleId };
    }
    return { kind: "clear" };
}

export function readPvpBrowserBreadcrumb(
    storage: Pick<Storage, "getItem" | "removeItem"> | null,
    key: string,
    expectedOwner: string,
    now = Date.now(),
): PvpBrowserBreadcrumb | null {
    if (!storage) return null;
    let raw: string | null = null;
    try {
        raw = storage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PvpBrowserBreadcrumb>;
        const age = now - Number(parsed.savedAt ?? 0);
        if (parsed.owner !== expectedOwner
            || typeof parsed.pvpBattleId !== "string"
            || !parsed.pvpBattleId.trim()
            || !Number.isFinite(age)
            || age < 0
            || age >= PVP_BROWSER_RECOVERY_TTL_MS
            || (parsed.pvpRole !== undefined && parsed.pvpRole !== "p1" && parsed.pvpRole !== "p2")) {
            storage.removeItem(key);
            return null;
        }
        return {
            owner: parsed.owner,
            pvpBattleId: parsed.pvpBattleId.trim(),
            pvpRole: parsed.pvpRole,
            pvpBattleContext: parsed.pvpBattleContext,
            savedAt: Number(parsed.savedAt),
        };
    } catch {
        try { if (raw) storage.removeItem(key); } catch { /* storage denied */ }
        return null;
    }
}

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
