import { newWorldRewardRequestId } from "./world-reward-api";
import { playerSlug } from "./utils";
import { raidStartActionScope, startActionDeadline } from "./action-deadline-store";

type AiRaidLaunchStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY_PREFIX = "aiRaidLaunch.v1:";
const AI_RAID_LAUNCH_MAX_AGE_MS = 45 * 60 * 1000;

type PendingAiRaidLaunch = {
    requestId: string;
    playerName: string;
    opponentId: string;
    sector: number;
    missionId?: string;
    createdAt: number;
    token?: string;
};

export type AiRaidLaunchProof = {
    requestId: string;
    token: string;
    opponentId: string;
    sector: number;
    source?: string;
    replayed: boolean;
};

export type AiRaidLaunchResult =
    | ({ ok: true } & AiRaidLaunchProof)
    | {
        ok: false;
        status: number;
        requestId: string;
        reason: string;
        code?: string;
        retryAfterMs?: number;
        error?: string;
    };

const volatileLaunches = new Map<string, PendingAiRaidLaunch[]>();
const playerKey = (name: string) => playerSlug(name);
const storageKey = (name: string) => `${KEY_PREFIX}${playerKey(name)}`;

function defaultStorage(): AiRaidLaunchStorage | null {
    try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function readLaunches(playerName: string, storage: AiRaidLaunchStorage | null = defaultStorage()): PendingAiRaidLaunch[] {
    const key = playerKey(playerName);
    if (!key) return [];
    let parsed: unknown = [];
    if (storage) {
        try {
            const raw = storage.getItem(storageKey(playerName));
            parsed = raw ? JSON.parse(raw) : [];
        } catch { parsed = []; }
    }
    const now = Date.now();
    const seen = new Set<string>();
    const valid = [...(Array.isArray(parsed) ? parsed : []), ...(volatileLaunches.get(key) ?? [])]
        .filter((entry): entry is PendingAiRaidLaunch => !!entry && typeof entry === "object"
            && typeof (entry as PendingAiRaidLaunch).requestId === "string"
            && /^[A-Za-z0-9_-]{8,96}$/.test((entry as PendingAiRaidLaunch).requestId)
            && playerKey((entry as PendingAiRaidLaunch).playerName) === key
            && typeof (entry as PendingAiRaidLaunch).opponentId === "string"
            && (entry as PendingAiRaidLaunch).opponentId.length > 0
            && Number.isSafeInteger((entry as PendingAiRaidLaunch).sector)
            && (entry as PendingAiRaidLaunch).sector >= 1
            && Number.isFinite((entry as PendingAiRaidLaunch).createdAt)
            && now - (entry as PendingAiRaidLaunch).createdAt <= AI_RAID_LAUNCH_MAX_AGE_MS)
        .filter((entry) => {
            if (seen.has(entry.requestId)) return false;
            seen.add(entry.requestId);
            return true;
        })
        .slice(-4);
    writeLaunches(playerName, valid, storage);
    return valid;
}

function writeLaunches(playerName: string, launches: PendingAiRaidLaunch[], storage: AiRaidLaunchStorage | null): void {
    const key = playerKey(playerName);
    if (!key) return;
    if (launches.length > 0) volatileLaunches.set(key, launches.slice(-4));
    else volatileLaunches.delete(key);
    if (!storage) return;
    try {
        if (launches.length > 0) storage.setItem(storageKey(playerName), JSON.stringify(launches.slice(-4)));
        else storage.removeItem(storageKey(playerName));
    } catch { /* same-session retries still use volatileLaunches */ }
}

function beginAiRaidLaunch(
    playerName: string,
    opponentId: string,
    sector: number,
    missionId?: string,
    storage: AiRaidLaunchStorage | null = defaultStorage(),
): PendingAiRaidLaunch {
    const launches = readLaunches(playerName, storage);
    const prior = launches.find((entry) => entry.opponentId === opponentId && entry.sector === sector && entry.missionId === missionId);
    if (prior) return prior;
    const launch = { requestId: newWorldRewardRequestId(), playerName, opponentId, sector, ...(missionId ? { missionId } : {}), createdAt: Date.now() };
    writeLaunches(playerName, [...launches, launch], storage);
    return launch;
}

export function completeAiRaidLaunch(
    playerName: string,
    raidToken: string,
    storage: AiRaidLaunchStorage | null = defaultStorage(),
): void {
    if (!raidToken) return;
    writeLaunches(playerName, readLaunches(playerName, storage).filter((entry) => entry.token !== raidToken), storage);
}

function retireAiRaidLaunchRequest(
    playerName: string,
    requestId: string,
    storage: AiRaidLaunchStorage | null = defaultStorage(),
): void {
    if (!requestId) return;
    writeLaunches(playerName, readLaunches(playerName, storage).filter((entry) => entry.requestId !== requestId), storage);
}

/** Mint/replay the proof that binds a village guard and sector to one raid. */
export async function mintAiRaidToken(params: {
    playerName: string;
    opponentId: string;
    sector: number;
    missionId?: string;
}): Promise<AiRaidLaunchResult> {
    const missionId = typeof params.missionId === "string" ? params.missionId.trim() : "";
    const opponentKey = missionId ? `mission_${missionId}` : params.opponentId;
    if (!params.playerName || !opponentKey || !Number.isSafeInteger(params.sector)
        || (missionId && !/^[A-Za-z0-9_-]{1,96}$/.test(missionId))) {
        return { ok: false, status: 0, requestId: "", reason: "invalid-request", code: "INVALID_REQUEST" };
    }
    const launch = beginAiRaidLaunch(params.playerName, opponentKey, params.sector, missionId || undefined);
    try {
        const response = await fetch("/api/missions/raid-start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                playerName: params.playerName,
                sector: params.sector,
                requestId: launch.requestId,
                ...(missionId ? { missionId } : { aiId: params.opponentId }),
            }),
        });
        const data = await response.json().catch(() => null) as {
            ok?: boolean;
            requestId?: string;
            token?: string | null;
            opponentId?: string;
            sector?: number;
            source?: string;
            replayed?: boolean;
            reason?: string;
            error?: string;
            code?: string;
            errorCode?: string;
            retryAfterMs?: number;
        } | null;
        const sealedSector = Math.floor(Number(data?.sector));
        const retryAfterMs = Number.isFinite(data?.retryAfterMs) && Number(data?.retryAfterMs) > 0
            ? Math.ceil(Number(data?.retryAfterMs))
            : undefined;
        if (!response.ok) {
            if (response.status === 409
                && data?.requestId === launch.requestId
                && (data.reason === "raid-launch-expired" || data.reason === "raid-launch-spent")) {
                retireAiRaidLaunchRequest(params.playerName, launch.requestId);
            }
            if (retryAfterMs) startActionDeadline(raidStartActionScope(params.playerName), retryAfterMs);
            return {
                ok: false,
                status: response.status,
                requestId: launch.requestId,
                reason: data?.reason ?? data?.code ?? data?.errorCode ?? "raid-start-rejected",
                ...(data?.code || data?.errorCode ? { code: data.code ?? data.errorCode } : {}),
                ...(retryAfterMs ? { retryAfterMs } : {}),
                ...(data?.error ? { error: data.error } : {}),
            };
        }
        if (data?.reason === "daily-mint-cap" && data.token === null) {
            retireAiRaidLaunchRequest(params.playerName, launch.requestId);
            if (retryAfterMs) startActionDeadline(raidStartActionScope(params.playerName), retryAfterMs);
            return {
                ok: false,
                status: response.status,
                requestId: launch.requestId,
                reason: data.reason,
                ...(data.code ? { code: data.code } : {}),
                ...(retryAfterMs ? { retryAfterMs } : {}),
                ...(data.error ? { error: data.error } : {}),
            };
        }
        if (data?.ok !== true || data.requestId !== launch.requestId
            || !data.token || !data.opponentId
            || !Number.isSafeInteger(sealedSector) || sealedSector < 1) {
            return {
                ok: false,
                status: response.status,
                requestId: launch.requestId,
                reason: data?.reason ?? "malformed-response",
                ...(data?.code || data?.errorCode ? { code: data.code ?? data.errorCode } : {}),
                ...(retryAfterMs ? { retryAfterMs } : {}),
                ...(data?.error ? { error: data.error } : {}),
            };
        }
        const launches = readLaunches(params.playerName);
        writeLaunches(params.playerName, launches.map((entry) => entry.requestId === launch.requestId
            ? { ...entry, token: data.token! }
            : entry), defaultStorage());
        return {
            ok: true,
            requestId: launch.requestId,
            token: data.token,
            opponentId: data.opponentId,
            sector: sealedSector,
            ...(data.source ? { source: data.source } : {}),
            replayed: data.replayed === true,
        };
    } catch {
        return {
            ok: false,
            status: 0,
            requestId: launch.requestId,
            reason: "network-error",
            code: "NETWORK_ERROR",
        };
    }
}

export function aiRaidLaunchFailureMessage(failure: Extract<AiRaidLaunchResult, { ok: false }>): string {
    const retrySeconds = failure.retryAfterMs ? Math.max(1, Math.ceil(failure.retryAfterMs / 1000)) : 0;
    if (failure.status === 429 || failure.code === "RATE_LIMITED") {
        return `Raid launches are cooling down. Try again in ${retrySeconds || 1}s.`;
    }
    switch (failure.reason) {
        case "mission-raid-encounter-unavailable": return "This field mission needs an authored outpost opponent before its raid can begin.";
        case "mission-raid-not-accepted": return "Accept this field mission before raiding its outpost.";
        case "mission-raid-sector-mismatch": return "Travel to this field mission's target sector before raiding its outpost.";
        case "mission-raid-objective-not-ready": return "Complete the field sweeps before raiding this mission outpost.";
        case "daily-mint-cap": return "Today's raid launch cap has been reached. It resets at midnight UTC.";
        case "sector-mismatch": return "Travel to the raid's sector before launching it.";
        case "no-presence": return "Your world location is still syncing. Wait a moment, then try the raid again.";
        case "battle-active":
        case "tower-battle-active": return "Finish or recover your active battle before starting a raid.";
        case "raid-launch-expired": return "That raid launch expired before combat began. Start the raid again.";
        case "raid-launch-spent": return "That raid launch has already been used. Start a new raid if you still want to continue.";
        case "network-error": return "The server could not confirm the raid launch. Your request is saved; retrying will use the same launch identity.";
        default:
            if (failure.status >= 500 || failure.status === 0) return "The server could not verify the raid right now. Try again in a moment.";
            return failure.error ?? "The raid could not be verified. Try again.";
    }
}
