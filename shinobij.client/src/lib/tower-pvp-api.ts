import type {
    TowerPvpActionResponse,
    TowerPvpMatchView,
    TowerPvpSettleResponse,
} from "../../../shared/tower-pvp";
import {
    createTowerMoveToken,
    TowerTransportError,
    type TowerActionInput,
    type TowerActionResponse,
    type TowerSession,
} from "./towers-api";

export type TowerPvpMatch = TowerPvpMatchView<TowerSession>;
export type TowerPvpPresence =
    | { state: "idle"; match: null; queuePosition: null }
    | { state: "queued"; match: null; queuePosition: number; queuedAt: number }
    | { state: "matched"; match: TowerPvpMatch; queuePosition: null };

type TowerPvpErrorBody = {
    error?: string;
    errorCode?: string;
    reason?: string;
    currentVersion?: number;
    match?: TowerPvpMatch;
};

export class TowerPvpApiError extends Error {
    override readonly name = "TowerPvpApiError";
    readonly status: number;
    readonly errorCode: string | undefined;
    readonly reason: string | undefined;
    readonly currentVersion: number | undefined;
    readonly match: TowerPvpMatch | undefined;
    constructor(
        message: string,
        status: number,
        errorCode?: string,
        match?: TowerPvpMatch,
        reason?: string,
        currentVersion?: number,
    ) {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
        this.match = match;
        this.reason = reason;
        this.currentVersion = currentVersion;
    }
}

const TOWER_PVP_TIMEOUT_MS = 12_000;

function clientRequestId(prefix: "queue" | "ready" | "leave"): string {
    const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    return `tpvp_${prefix}_${random}`.slice(0, 80);
}

async function pvpJson<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const external = init?.signal;
    const abortFromExternal = () => controller.abort(external?.reason);
    if (external?.aborted) abortFromExternal();
    else external?.addEventListener("abort", abortFromExternal, { once: true });
    const timeout = globalThis.setTimeout(() => controller.abort(new DOMException("Tower Team Arena timed out.", "TimeoutError")), TOWER_PVP_TIMEOUT_MS);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const body = await response.json().catch(() => ({})) as T & TowerPvpErrorBody;
        if (!response.ok) {
            throw new TowerPvpApiError(
                body.error || body.reason || `Request failed (${response.status})`,
                response.status,
                body.errorCode,
                body.match,
                body.reason,
                body.currentVersion,
            );
        }
        return body;
    } catch (error) {
        if (error instanceof TowerPvpApiError) throw error;
        if (controller.signal.aborted || error instanceof TypeError) {
            throw new TowerTransportError(external?.aborted ? "Tower Team Arena request cancelled." : "Tower Team Arena connection was interrupted.");
        }
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
        external?.removeEventListener("abort", abortFromExternal);
    }
}

async function replayTransportOnce<T>(request: () => Promise<T>): Promise<T> {
    try {
        return await request();
    } catch (error) {
        if (!(error instanceof TowerTransportError)) throw error;
        return request();
    }
}

export async function fetchTowerPvpPresence(playerName: string, signal?: AbortSignal): Promise<TowerPvpPresence> {
    const data = await pvpJson<{ presence: TowerPvpPresence }>(
        `/api/towers/pvp-queue?playerName=${encodeURIComponent(playerName)}`,
        { signal },
    );
    return data.presence;
}

export function joinTowerPvpQueue(playerName: string): Promise<{ replayed: boolean; presence: TowerPvpPresence }> {
    const body = { action: "join", playerName, requestId: clientRequestId("queue") } as const;
    return replayTransportOnce(() => pvpJson("/api/towers/pvp-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }));
}

export function setTowerPvpReady(
    playerName: string,
    match: TowerPvpMatch,
    ready: boolean,
): Promise<{ replayed: boolean; match: TowerPvpMatch }> {
    const body = {
        action: "ready",
        playerName,
        matchId: match.matchId,
        ready,
        requestId: clientRequestId("ready"),
        expectedVersion: match.version,
    } as const;
    return replayTransportOnce(() => pvpJson("/api/towers/pvp-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }));
}

export function leaveTowerPvp(
    playerName: string,
    match?: TowerPvpMatch | null,
): Promise<{ replayed: boolean; match: TowerPvpMatch | null; presence: TowerPvpPresence }> {
    const body = {
        action: "leave",
        playerName,
        requestId: clientRequestId("leave"),
        ...(match ? { matchId: match.matchId, expectedVersion: match.version } : {}),
    } as const;
    return replayTransportOnce(() => pvpJson("/api/towers/pvp-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }));
}

export async function fetchTowerPvpMatch(matchId: string, playerName: string, signal?: AbortSignal): Promise<TowerPvpMatch> {
    const data = await pvpJson<{ match: TowerPvpMatch }>(
        `/api/towers/pvp-state?matchId=${encodeURIComponent(matchId)}&playerName=${encodeURIComponent(playerName)}`,
        { signal },
    );
    return data.match;
}

function pvpActionBody(action: TowerActionInput): Record<string, unknown> {
    if (action.type === "item" || action.type === "summon") {
        throw new Error("Consumables and summons are disabled in the Tower Team Arena.");
    }
    return action;
}

export async function submitTowerPvpActionWithLostResponseRetry(
    matchId: string,
    playerName: string,
    action: TowerActionInput,
    expectedVersion?: number,
): Promise<TowerActionResponse> {
    if (!Number.isSafeInteger(expectedVersion)) throw new Error("The match revision is missing. Reconnect before acting.");
    const body = {
        playerName,
        matchId,
        ...pvpActionBody(action),
        moveToken: createTowerMoveToken(),
        expectedVersion,
    };
    const request = () => pvpJson<TowerPvpActionResponse<TowerSession>>("/api/towers/pvp-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    let response: TowerPvpActionResponse<TowerSession>;
    try {
        response = await replayTransportOnce(request);
    } catch (error) {
        // Optimistic conflicts are authoritative state responses, not transport
        // failures. Mirror the regular Tower action contract so the board adopts
        // the projected match immediately instead of waiting for another push/poll.
        if (error instanceof TowerPvpApiError && error.match) {
            const currentVersion = Number.isSafeInteger(error.currentVersion)
                ? Number(error.currentVersion)
                : Number(error.match.combat.actionVersion ?? error.match.version);
            return {
                applied: false,
                replayed: false,
                reason: error.reason ?? error.errorCode,
                session: error.match.combat,
                currentVersion,
            };
        }
        throw error;
    }
    return {
        applied: response.applied,
        replayed: response.replayed,
        reason: response.reason,
        session: response.match.combat,
        currentVersion: response.currentVersion,
    };
}

/** BattleTowerFight-compatible authoritative state transport. */
export async function fetchTowerPvpSession(matchId: string, playerName: string, signal?: AbortSignal): Promise<TowerSession> {
    return (await fetchTowerPvpMatch(matchId, playerName, signal)).combat;
}

export function settleTowerPvp(
    matchId: string,
    playerName: string,
): Promise<TowerPvpSettleResponse<TowerSession>> {
    return replayTransportOnce(() => pvpJson("/api/towers/pvp-settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, playerName }),
    }));
}

/** Acknowledge the zero-reward result, then clear this player's terminal match pointer. */
export async function settleAndLeaveTowerPvp(matchId: string, playerName: string): Promise<TowerPvpSettleResponse<TowerSession>> {
    const settled = await settleTowerPvp(matchId, playerName);
    await leaveTowerPvp(playerName, settled.match as TowerPvpMatch);
    return settled;
}
