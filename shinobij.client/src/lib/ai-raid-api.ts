import { newWorldRewardRequestId } from "./world-reward-api";
import { playerSlug } from "./utils";

type AiRaidLaunchStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY_PREFIX = "aiRaidLaunch.v1:";
const AI_RAID_LAUNCH_MAX_AGE_MS = 45 * 60 * 1000;

type PendingAiRaidLaunch = {
    requestId: string;
    playerName: string;
    opponentId: string;
    sector: number;
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
    storage: AiRaidLaunchStorage | null = defaultStorage(),
): PendingAiRaidLaunch {
    const launches = readLaunches(playerName, storage);
    const prior = launches.find((entry) => entry.opponentId === opponentId && entry.sector === sector);
    if (prior) return prior;
    const launch = { requestId: newWorldRewardRequestId(), playerName, opponentId, sector, createdAt: Date.now() };
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
}): Promise<AiRaidLaunchProof | null> {
    if (!params.playerName || !params.opponentId || !Number.isSafeInteger(params.sector)) return null;
    const launch = beginAiRaidLaunch(params.playerName, params.opponentId, params.sector);
    try {
        const response = await fetch("/api/missions/raid-start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                playerName: params.playerName,
                aiId: params.opponentId,
                sector: params.sector,
                requestId: launch.requestId,
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
        } | null;
        const sealedSector = Math.floor(Number(data?.sector));
        if (!response.ok) {
            if (response.status === 409
                && data?.requestId === launch.requestId
                && (data.reason === "raid-launch-expired" || data.reason === "raid-launch-spent")) {
                retireAiRaidLaunchRequest(params.playerName, launch.requestId);
            }
            return null;
        }
        if (data?.ok !== true || data.requestId !== launch.requestId
            || !data.token || !data.opponentId
            || !Number.isSafeInteger(sealedSector) || sealedSector < 1) return null;
        const launches = readLaunches(params.playerName);
        writeLaunches(params.playerName, launches.map((entry) => entry.requestId === launch.requestId
            ? { ...entry, token: data.token! }
            : entry), defaultStorage());
        return {
            requestId: launch.requestId,
            token: data.token,
            opponentId: data.opponentId,
            sector: sealedSector,
            ...(data.source ? { source: data.source } : {}),
            replayed: data.replayed === true,
        };
    } catch {
        return null;
    }
}
