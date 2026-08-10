import { normalizePlayerIdentity } from "./player-request-owner";

export type ArenaCoopRecovery = {
    version: 1;
    normalizedPlayerName: string;
    code: string;
    createdAt: number;
};

/** Running-match recovery is retained only while the replay is interruptible.
 * Once the result is visible, Exit is a terminal user choice and must not
 * reopen the completed seal on the next visit. */
export function shouldRetainArenaCoopRecovery(
    lobbyState: "lobby" | "running" | null | undefined,
    matchFinished: boolean,
): boolean {
    return lobbyState === "running" && !matchFinished;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const PREFIX = "wfCoopLobby.v1";
const MAX_AGE_MS = 45 * 60_000;
const CODE_RE = /^(?:[A-HJ-NP-Z2-9]{4}|[A-HJ-NP-Z2-9]{8})$/;

export const arenaCoopRecoveryKey = (playerName: string): string | null => {
    const normalized = normalizePlayerIdentity(playerName);
    return normalized ? `${PREFIX}:${encodeURIComponent(normalized)}` : null;
};

export function parseArenaCoopRecovery(value: unknown, playerName: string, now = Date.now()): ArenaCoopRecovery | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Partial<ArenaCoopRecovery>;
    const normalized = normalizePlayerIdentity(playerName);
    if (item.version !== 1 || item.normalizedPlayerName !== normalized
        || typeof item.code !== "string" || !CODE_RE.test(item.code)
        || !Number.isSafeInteger(item.createdAt) || (item.createdAt ?? 0) <= 0
        || (item.createdAt ?? 0) > now + 30_000 || now - (item.createdAt ?? 0) > MAX_AGE_MS) return null;
    return item as ArenaCoopRecovery;
}

export function readArenaCoopRecovery(playerName: string, storage: StorageLike = localStorage, now = Date.now()): ArenaCoopRecovery | null {
    const key = arenaCoopRecoveryKey(playerName);
    if (!key) return null;
    try {
        const raw = storage.getItem(key);
        const parsed = raw ? parseArenaCoopRecovery(JSON.parse(raw), playerName, now) : null;
        if (raw && !parsed) storage.removeItem(key);
        return parsed;
    } catch {
        try { storage.removeItem(key); } catch { /* storage unavailable */ }
        return null;
    }
}

export function writeArenaCoopRecovery(record: ArenaCoopRecovery, storage: StorageLike = localStorage): boolean {
    const parsed = parseArenaCoopRecovery(record, record.normalizedPlayerName, Date.now());
    const key = parsed ? arenaCoopRecoveryKey(record.normalizedPlayerName) : null;
    if (!parsed || !key) return false;
    try {
        storage.setItem(key, JSON.stringify(parsed));
        return true;
    } catch {
        return false;
    }
}

export function clearArenaCoopRecovery(playerName: string, code?: string, storage: StorageLike = localStorage): void {
    const key = arenaCoopRecoveryKey(playerName);
    if (!key) return;
    try {
        if (code) {
            const current = readArenaCoopRecovery(playerName, storage);
            if (current?.code !== code) return;
        }
        storage.removeItem(key);
    } catch {
        // Server membership remains authoritative when storage is unavailable.
    }
}
