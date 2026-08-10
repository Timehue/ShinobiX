import { normalizePlayerIdentity } from "./player-request-owner";

export type ArenaPvpRecoveryRole = "challenger" | "responder";
export type ArenaPvpRecovery = {
    version: 1;
    challengeId: string;
    playerName: string;
    counterpartName: string;
    role: ArenaPvpRecoveryRole;
    createdAt: number;
};

export type OpaqueAcceptedArenaNotice = {
    id: string;
    arenaMatch: true;
    accepted: true;
    declined: false;
    fromName: string;
    toName: string;
    challengerSetupSealed: true;
    recoveryRequired: true;
};

const OPAQUE_NOTICE_FIELDS = new Set([
    "id", "arenaMatch", "accepted", "declined", "fromName", "toName",
    "challengerSetupSealed", "recoveryRequired",
]);

/** Strictly recognizes the only accepted Arena shape allowed in the
 * Realtime inbox. In particular, it contains no private roster, seed, or
 * setup and therefore must route through the authenticated recovery GET. */
export function parseOpaqueAcceptedArenaNotice(value: unknown): OpaqueAcceptedArenaNotice | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Partial<OpaqueAcceptedArenaNotice> & Record<string, unknown>;
    if (Object.keys(item).length !== OPAQUE_NOTICE_FIELDS.size
        || Object.keys(item).some((key) => !OPAQUE_NOTICE_FIELDS.has(key))
        || typeof item.id !== "string" || !item.id || item.id.length > 128
        || item.arenaMatch !== true || item.accepted !== true || item.declined !== false
        || item.challengerSetupSealed !== true || item.recoveryRequired !== true
        || typeof item.fromName !== "string" || !normalizePlayerIdentity(item.fromName)
        || typeof item.toName !== "string" || !normalizePlayerIdentity(item.toName)) return null;
    return item as OpaqueAcceptedArenaNotice;
}

/** Heartbeat ingestion bypasses Character normalization only for the exact
 * opaque Arena wake-up shape. Every ordinary challenge still needs a valid
 * challenger object and goes through the supplied normalizer. */
export function ingestChallengeInboxEntry<T extends object, U>(
    value: T,
    normalizeChallenger: (challenger: unknown) => U,
): (T & { challenger?: U }) | OpaqueAcceptedArenaNotice | null {
    const opaque = parseOpaqueAcceptedArenaNotice(value);
    if (opaque) return opaque;
    const challenger = (value as { challenger?: unknown }).challenger;
    if (!challenger || typeof challenger !== "object" || Array.isArray(challenger)) return null;
    try {
        return { ...value, challenger: normalizeChallenger(challenger) };
    } catch {
        return null;
    }
}

export function recoveryFromOpaqueArenaNotice(
    value: unknown,
    playerName: string,
    now = Date.now(),
): ArenaPvpRecovery | null {
    const notice = parseOpaqueAcceptedArenaNotice(value);
    if (!notice || normalizePlayerIdentity(notice.toName) !== normalizePlayerIdentity(playerName)) return null;
    return {
        version: 1,
        challengeId: notice.id,
        playerName,
        counterpartName: notice.fromName,
        role: "challenger",
        createdAt: now,
    };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const MAX_AGE_MS = 60 * 60 * 1_000;
const PREFIX = "wfArenaRecovery.v1";

export const arenaPvpRecoveryKey = (playerName: string): string | null => {
    const normalized = normalizePlayerIdentity(playerName);
    return normalized ? `${PREFIX}:${encodeURIComponent(normalized)}` : null;
};

export function parseArenaPvpRecovery(value: unknown, playerName: string, now = Date.now()): ArenaPvpRecovery | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Partial<ArenaPvpRecovery>;
    if (record.version !== 1 || (record.role !== "challenger" && record.role !== "responder")
        || typeof record.challengeId !== "string" || !record.challengeId || record.challengeId.length > 128
        || typeof record.playerName !== "string" || normalizePlayerIdentity(record.playerName) !== normalizePlayerIdentity(playerName)
        || typeof record.counterpartName !== "string" || !normalizePlayerIdentity(record.counterpartName)
        || typeof record.createdAt !== "number" || !Number.isSafeInteger(record.createdAt)
        || record.createdAt > now + 30_000 || now - record.createdAt > MAX_AGE_MS) return null;
    return record as ArenaPvpRecovery;
}

export function readArenaPvpRecovery(playerName: string, storage: StorageLike = localStorage, now = Date.now()): ArenaPvpRecovery | null {
    const key = arenaPvpRecoveryKey(playerName);
    if (!key) return null;
    try {
        const raw = storage.getItem(key);
        const parsed = raw ? parseArenaPvpRecovery(JSON.parse(raw), playerName, now) : null;
        if (!parsed && raw) storage.removeItem(key);
        return parsed;
    } catch {
        try { storage.removeItem(key); } catch { /* storage unavailable */ }
        return null;
    }
}

export function writeArenaPvpRecovery(record: ArenaPvpRecovery, storage: StorageLike = localStorage): boolean {
    const parsed = parseArenaPvpRecovery(record, record.playerName, record.createdAt);
    const key = parsed ? arenaPvpRecoveryKey(record.playerName) : null;
    if (!parsed || !key) return false;
    try {
        storage.setItem(key, JSON.stringify(parsed));
        return true;
    } catch {
        return false;
    }
}

export function clearArenaPvpRecovery(playerName: string, challengeId?: string, storage: StorageLike = localStorage): void {
    const key = arenaPvpRecoveryKey(playerName);
    if (!key) return;
    try {
        if (challengeId) {
            const current = readArenaPvpRecovery(playerName, storage);
            if (current?.challengeId !== challengeId) return;
        }
        storage.removeItem(key);
    } catch {
        // Storage is optional; server recovery remains authoritative.
    }
}

export function recoveredChallengeMatches(
    record: ArenaPvpRecovery,
    challenge: { id?: string; accepted?: boolean; fromName?: string; toName?: string; challenger?: { name?: string }; challengerWarfrontSetup?: unknown; responderWarfrontSetup?: unknown },
): boolean {
    if (challenge.id !== record.challengeId || challenge.accepted !== true
        || !challenge.challengerWarfrontSetup || !challenge.responderWarfrontSetup) return false;
    const me = normalizePlayerIdentity(record.playerName);
    const counterpart = normalizePlayerIdentity(record.counterpartName);
    return record.role === "challenger"
        ? normalizePlayerIdentity(challenge.toName ?? "") === me
            && normalizePlayerIdentity(challenge.fromName ?? "") === counterpart
            && normalizePlayerIdentity(challenge.challenger?.name ?? "") === me
        : normalizePlayerIdentity(challenge.fromName ?? "") === me
            && normalizePlayerIdentity(challenge.toName ?? "") === counterpart
            && normalizePlayerIdentity(challenge.challenger?.name ?? "") === counterpart;
}
