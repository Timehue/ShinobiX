import { createHash } from 'node:crypto';
import type { KvLike } from '../_storage.js';
import { AI_FIGHT_TOKEN_TTL_SECONDS, type AiFightToken } from './_ai-fight-token.js';

export const AI_FIGHT_REWARD_SETTLEMENTS_FIELD = 'aiFightRewardSettlements';
export const AI_FIGHT_ACTIVE_REDEMPTION_LIMIT = 1_024;
export const AI_FIGHT_DAILY_RESERVATION_VERSION = 1;

export type AiFightRedemption = {
    token: string;
    xp: number;
    ryo: number;
    capped: boolean;
    dailyCount: number;
};

type AiFightRewardReceipt = AiFightRedemption & {
    fingerprint: string;
    mintedAt: number;
    expiresAt: number;
    settledAt: number;
};

type AiFightDailyCount = {
    date: string;
    count: number;
    updatedAt: number;
};

type AiFightRewardManifest = {
    version: 1;
    receipts: AiFightRewardReceipt[];
    dailyCounts: AiFightDailyCount[];
};

export type AiFightRedemptionInspection =
    | { ok: true; replayed: true; redemption: AiFightRedemption }
    | {
        ok: true;
        replayed: false;
        fingerprint: string;
        mintedAt: number;
        expiresAt: number;
        now: number;
        date: string;
        paysReward: boolean;
        dailyCount: number;
        activeReceipts: AiFightRewardReceipt[];
        dailyCounts: AiFightDailyCount[];
    }
    | { ok: false; status: number; error: string };

type AiFightCounterStore = Pick<KvLike, 'get' | 'compareSet'>;

type AiFightDailyOrdinalReservation = {
    version: typeof AI_FIGHT_DAILY_RESERVATION_VERSION;
    playerName: string;
    token: string;
    mintedAt: number;
    date: string;
    state: 'pending' | 'committed';
    dailyCount?: number;
};

export type AiFightReservedDailyOrdinal = {
    date: string;
    dailyCount: number;
    counterKey: string;
};

function parsedLegacyCounter(value: unknown): number | null {
    if (value === null) return 0;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
/** Read the rolling-worker scalar without converting malformed state to zero. */
export async function readAiFightLegacyDailyCount(
    store: Pick<KvLike, 'get'>,
    key: string,
): Promise<number> {
    const parsed = parsedLegacyCounter(await store.get<unknown>(key));
    if (parsed === null) throw new Error('ai-fight-daily-counter-invalid');
    return parsed;
}

export function aiFightDailyCounterKey(playerName: string, date: string): string {
    return `ai-fight-count:${playerName.toLowerCase()}:${date}`;
}

export function aiFightDailyReservationKey(playerName: string, token: string): string {
    return `ai-fight-daily-reservation:${playerName.toLowerCase()}:${token}`;
}

function parseDailyOrdinalReservation(raw: unknown): AiFightDailyOrdinalReservation | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<AiFightDailyOrdinalReservation>;
    const mintedAt = safeInteger(value.mintedAt);
    const dailyCount = value.state === 'committed' ? safeInteger(value.dailyCount) : undefined;
    if (value.version !== AI_FIGHT_DAILY_RESERVATION_VERSION
        || typeof value.playerName !== 'string' || value.playerName !== value.playerName.toLowerCase()
        || typeof value.token !== 'string' || !/^[A-Za-z0-9]{1,96}$/.test(value.token)
        || mintedAt === null || mintedAt <= 0
        || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
        || (value.state !== 'pending' && value.state !== 'committed')
        || (value.state === 'pending' && value.dailyCount !== undefined)
        || (value.state === 'committed' && (dailyCount === null || dailyCount === undefined || dailyCount <= 0))) return null;
    return {
        version: AI_FIGHT_DAILY_RESERVATION_VERSION,
        playerName: value.playerName,
        token: value.token,
        mintedAt,
        date: value.date,
        state: value.state,
        ...(value.state === 'committed' ? { dailyCount: dailyCount as number } : {}),
    };
}

function sameDailyReservationIdentity(
    reservation: AiFightDailyOrdinalReservation,
    playerName: string,
    token: string,
    mintedAt: number,
): boolean {
    return reservation.playerName === playerName.toLowerCase()
        && reservation.token === token
        && reservation.mintedAt === mintedAt;
}

/**
 * Reserve the reward's UTC-day ordinal against the exact scalar used by old
 * rolling workers. A legacy INCR and this exact CAS cannot both own the same
 * predecessor. If the counter CAS acknowledgement is lost, its readback is not
 * treated as proof: an old worker could have produced the same number. We burn
 * that ambiguous ordinal and continue until this token has an exact committed
 * reservation record. Retries return only that record, including across UTC
 * midnight, so a token can never change day or ordinal after uncertainty.
 */
export async function reserveAiFightDailyOrdinal(
    store: AiFightCounterStore,
    params: {
        playerName: string;
        token: string;
        mintedAt: number;
        requestedDate: string;
        minimumDailyCounts?: Readonly<Record<string, number>>;
        ttlSeconds: number;
    },
): Promise<AiFightReservedDailyOrdinal> {
    const playerName = params.playerName.toLowerCase();
    const mintedAt = Math.floor(Number(params.mintedAt) || 0);
    if (!playerName || !/^[A-Za-z0-9]{1,96}$/.test(params.token)
        || mintedAt <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(params.requestedDate)
        || !Number.isSafeInteger(params.ttlSeconds) || params.ttlSeconds <= 0) {
        throw new Error('ai-fight-daily-reservation-input-invalid');
    }
    const reservationKey = aiFightDailyReservationKey(playerName, params.token);
    let pending: AiFightDailyOrdinalReservation | null = null;

    for (let attempt = 0; attempt < 64; attempt += 1) {
        const rawReservation = await store.get<unknown>(reservationKey);
        if (rawReservation !== null && rawReservation !== undefined) {
            const existing = parseDailyOrdinalReservation(rawReservation);
            if (!existing || !sameDailyReservationIdentity(existing, playerName, params.token, mintedAt)) {
                throw new Error('ai-fight-daily-reservation-conflict');
            }
            if (existing.state === 'committed') {
                return {
                    date: existing.date,
                    dailyCount: existing.dailyCount as number,
                    counterKey: aiFightDailyCounterKey(playerName, existing.date),
                };
            }
            pending = existing;
        } else {
            pending = {
                version: AI_FIGHT_DAILY_RESERVATION_VERSION,
                playerName,
                token: params.token,
                mintedAt,
                date: params.requestedDate,
                state: 'pending',
            };
            try {
                if (await store.compareSet(reservationKey, null, pending, { ex: params.ttlSeconds }) !== true) {
                    continue;
                }
            } catch (error) {
                const readbackRaw = await store.get<unknown>(reservationKey).catch(() => null);
                const readback = parseDailyOrdinalReservation(readbackRaw);
                if (!readback || !sameDailyReservationIdentity(readback, playerName, params.token, mintedAt)) throw error;
                if (readback.state === 'committed') {
                    return {
                        date: readback.date,
                        dailyCount: readback.dailyCount as number,
                        counterKey: aiFightDailyCounterKey(playerName, readback.date),
                    };
                }
                pending = readback;
            }
        }

        const counterKey = aiFightDailyCounterKey(playerName, pending.date);
        const rawCounter = await store.get<unknown>(counterKey);
        const current = parsedLegacyCounter(rawCounter);
        if (current === null) throw new Error('ai-fight-daily-counter-invalid');
        const minimumRaw = params.minimumDailyCounts?.[pending.date] ?? 0;
        const minimum = Math.max(0, Math.floor(Number(minimumRaw) || 0));
        const dailyCount = Math.max(current, minimum) + 1;
        if (!Number.isSafeInteger(dailyCount)) throw new Error('ai-fight-daily-counter-overflow');

        try {
            if (await store.compareSet(counterKey, rawCounter, dailyCount, { ex: params.ttlSeconds }) !== true) {
                continue;
            }
        } catch {
            // Do not infer ownership from counter readback: a legacy INCR can
            // produce the identical value after our compareSet failed. Looping
            // deliberately burns a possibly committed ordinal and is the only
            // safe mixed-version answer.
            const exactReservationRaw = await store.get<unknown>(reservationKey).catch(() => null);
            const exactReservation = parseDailyOrdinalReservation(exactReservationRaw);
            if (exactReservation
                && sameDailyReservationIdentity(exactReservation, playerName, params.token, mintedAt)
                && exactReservation.state === 'committed') {
                return {
                    date: exactReservation.date,
                    dailyCount: exactReservation.dailyCount as number,
                    counterKey: aiFightDailyCounterKey(playerName, exactReservation.date),
                };
            }
            continue;
        }

        const committed: AiFightDailyOrdinalReservation = { ...pending, state: 'committed', dailyCount };
        try {
            if (await store.compareSet(reservationKey, pending, committed, { ex: params.ttlSeconds }) === true) {
                return { date: pending.date, dailyCount, counterKey };
            }
        } catch (error) {
            const readbackRaw = await store.get<unknown>(reservationKey).catch(() => null);
            const readback = parseDailyOrdinalReservation(readbackRaw);
            if (!readback || !sameDailyReservationIdentity(readback, playerName, params.token, mintedAt)) throw error;
            if (readback.state === 'committed') {
                return {
                    date: readback.date,
                    dailyCount: readback.dailyCount as number,
                    counterKey: aiFightDailyCounterKey(playerName, readback.date),
                };
            }
            continue;
        }
        const winnerRaw = await store.get<unknown>(reservationKey);
        const winner = parseDailyOrdinalReservation(winnerRaw);
        if (!winner || !sameDailyReservationIdentity(winner, playerName, params.token, mintedAt)) {
            throw new Error('ai-fight-daily-reservation-conflict');
        }
        if (winner.state === 'committed') {
            return {
                date: winner.date,
                dailyCount: winner.dailyCount as number,
                counterKey: aiFightDailyCounterKey(playerName, winner.date),
            };
        }
    }
    throw new Error('ai-fight-daily-reservation-busy');
}

/**
 * Mirror the save-authoritative daily count for rolling workers without ever
 * moving the legacy scalar backwards. The exact raw predecessor is compared so
 * an old worker's concurrent INCR always wins over a stale mirror. A fulfilled
 * mismatch (including a broken null acknowledgement) is retried; a thrown
 * acknowledgement is accepted only when a confirmed readback is at least the
 * requested count.
 */
export async function mirrorAiFightDailyCountMonotonic(
    store: AiFightCounterStore,
    key: string,
    targetRaw: number,
    ttlSeconds: number,
): Promise<number> {
    const target = Math.max(0, Math.floor(Number(targetRaw) || 0));
    if (!Number.isSafeInteger(target)) throw new Error('ai-fight-daily-counter-target-invalid');
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const raw = await store.get<unknown>(key);
        const current = parsedLegacyCounter(raw);
        if (current === null) throw new Error('ai-fight-daily-counter-invalid');
        if (current >= target) return current;
        try {
            if (await store.compareSet(key, raw, target, { ex: ttlSeconds }) === true) return target;
        } catch (error) {
            const readback = await store.get<unknown>(key).catch(() => null);
            const confirmed = parsedLegacyCounter(readback);
            if (confirmed !== null && confirmed >= target) return confirmed;
            throw error;
        }
        // A false/null acknowledgement is definitive only for this predecessor.
        // Re-read to observe either a racing legacy INCR or a committed-but-
        // malformed transport acknowledgement before trying again.
    }
    throw new Error('ai-fight-daily-counter-conflict');
}

function safeInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseReceipt(raw: unknown): AiFightRewardReceipt | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<AiFightRewardReceipt>;
    const xp = safeInteger(value.xp);
    const ryo = safeInteger(value.ryo);
    const dailyCount = safeInteger(value.dailyCount);
    const mintedAt = safeInteger(value.mintedAt);
    const expiresAt = safeInteger(value.expiresAt);
    const settledAt = safeInteger(value.settledAt);
    if (typeof value.token !== 'string' || !/^[A-Za-z0-9]{1,96}$/.test(value.token)
        || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
        || xp === null || ryo === null || dailyCount === null
        || typeof value.capped !== 'boolean'
        || mintedAt === null || mintedAt <= 0
        || expiresAt === null || expiresAt <= mintedAt
        || expiresAt - mintedAt > (AI_FIGHT_TOKEN_TTL_SECONDS + 60) * 1_000
        || settledAt === null || settledAt <= 0) return null;
    return {
        token: value.token,
        fingerprint: value.fingerprint,
        mintedAt,
        expiresAt,
        settledAt,
        xp,
        ryo,
        capped: value.capped,
        dailyCount,
    };
}

function parseDailyCount(raw: unknown): AiFightDailyCount | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<AiFightDailyCount>;
    const count = safeInteger(value.count);
    const updatedAt = safeInteger(value.updatedAt);
    if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
        || count === null || updatedAt === null || updatedAt <= 0) return null;
    return { date: value.date, count, updatedAt };
}

function parseManifest(character: Record<string, unknown>): AiFightRewardManifest | null {
    const raw = character[AI_FIGHT_REWARD_SETTLEMENTS_FIELD];
    if (raw === undefined) return { version: 1, receipts: [], dailyCounts: [] };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<AiFightRewardManifest>;
    if (value.version !== 1 || !Array.isArray(value.receipts) || !Array.isArray(value.dailyCounts)) return null;
    const receipts: AiFightRewardReceipt[] = [];
    const tokens = new Set<string>();
    for (const rawReceipt of value.receipts) {
        const receipt = parseReceipt(rawReceipt);
        if (!receipt || tokens.has(receipt.token)) return null;
        tokens.add(receipt.token);
        receipts.push(receipt);
    }
    const dailyCounts: AiFightDailyCount[] = [];
    const dates = new Set<string>();
    for (const rawCount of value.dailyCounts) {
        const count = parseDailyCount(rawCount);
        if (!count || dates.has(count.date)) return null;
        dates.add(count.date);
        dailyCounts.push(count);
    }
    return { version: 1, receipts, dailyCounts };
}

export function aiFightSavedDailyCounts(character: Record<string, unknown>): Readonly<Record<string, number>> {
    const manifest = parseManifest(character);
    if (!manifest) throw new Error('ai-fight-redemption-authority-invalid');
    return Object.fromEntries(manifest.dailyCounts.map((entry) => [entry.date, entry.count]));
}

export function aiFightRedemptionFingerprint(params: {
    playerName: string;
    token: string;
    tokenData: AiFightToken;
    sessionId: string;
    outcome: string;
    battleKind: string;
    claim: { xp: number; ryo: number };
}): string {
    return createHash('sha256').update(JSON.stringify({
        version: 1,
        playerName: params.playerName.toLowerCase(),
        token: params.token,
        tokenId: params.tokenData.tokenId,
        mintedAt: params.tokenData.mintedAt,
        sessionId: params.sessionId,
        outcome: params.outcome,
        battleKind: params.battleKind,
        xp: params.claim.xp,
        ryo: params.claim.ryo,
    })).digest('hex');
}

export function inspectAiFightRedemptionAuthority(params: {
    character: Record<string, unknown>;
    token: string;
    fingerprint: string;
    mintedAt: number;
    now: number;
    date: string;
    paysReward: boolean;
    reservedDailyCount?: number;
}): AiFightRedemptionInspection {
    const manifest = parseManifest(params.character);
    if (!manifest) return { ok: false, status: 409, error: 'The AI-fight redemption authority is invalid.' };
    const existing = manifest.receipts.find((entry) => entry.token === params.token);
    if (existing) {
        if (existing.fingerprint !== params.fingerprint) {
            return { ok: false, status: 409, error: 'The AI-fight redemption authority conflicts with this token.' };
        }
        return {
            ok: true,
            replayed: true,
            redemption: {
                token: existing.token,
                xp: existing.xp,
                ryo: existing.ryo,
                capped: existing.capped,
                dailyCount: existing.dailyCount,
            },
        };
    }
    const mintedAt = Math.floor(Number(params.mintedAt) || 0);
    const expiresAt = mintedAt + AI_FIGHT_TOKEN_TTL_SECONDS * 1_000;
    if (mintedAt <= 0 || expiresAt <= params.now) {
        return { ok: false, status: 409, error: 'The AI-fight token has expired.' };
    }
    const activeReceipts = manifest.receipts.filter((entry) => entry.expiresAt > params.now);
    if (activeReceipts.length >= AI_FIGHT_ACTIVE_REDEMPTION_LIMIT) {
        return { ok: false, status: 429, error: 'Too many AI-fight redemptions are still settling.' };
    }
    const savedDailyCount = manifest.dailyCounts.find((entry) => entry.date === params.date)?.count ?? 0;
    const reservedDailyCount = Math.max(0, Math.floor(Number(params.reservedDailyCount) || 0));
    if (params.paysReward && (reservedDailyCount <= 0 || reservedDailyCount <= savedDailyCount)) {
        return { ok: false, status: 409, error: 'The AI-fight daily ordinal was not reserved authoritatively.' };
    }
    return {
        ok: true,
        replayed: false,
        fingerprint: params.fingerprint,
        mintedAt,
        expiresAt,
        now: params.now,
        date: params.date,
        paysReward: params.paysReward,
        dailyCount: params.paysReward ? reservedDailyCount : 0,
        activeReceipts,
        dailyCounts: manifest.dailyCounts,
    };
}

export function commitAiFightRedemptionAuthority(
    character: Record<string, unknown>,
    inspection: Extract<AiFightRedemptionInspection, { ok: true; replayed: false }>,
    redemption: AiFightRedemption,
    _options: { counterAlreadyCommitted?: boolean } = {},
): Record<string, unknown> {
    const receipt: AiFightRewardReceipt = {
        ...redemption,
        fingerprint: inspection.fingerprint,
        mintedAt: inspection.mintedAt,
        expiresAt: inspection.expiresAt,
        settledAt: inspection.now,
    };
    const savedDailyCount = inspection.dailyCounts.find((entry) => entry.date === inspection.date)?.count ?? 0;
    const committedDailyCount = Math.max(savedDailyCount, inspection.dailyCount, redemption.dailyCount);
    const dailyCounts = inspection.paysReward
        ? [
            { date: inspection.date, count: committedDailyCount, updatedAt: inspection.now },
            ...inspection.dailyCounts.filter((entry) => entry.date !== inspection.date),
        ].slice(0, 3)
        : inspection.dailyCounts.slice(0, 3);
    return {
        ...character,
        [AI_FIGHT_REWARD_SETTLEMENTS_FIELD]: {
            version: 1,
            receipts: [receipt, ...inspection.activeReceipts],
            dailyCounts,
        } satisfies AiFightRewardManifest,
    };
}
