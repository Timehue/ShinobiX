import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import {
    isPetRankedMatchId,
    isServerResolvedPetRankedToken,
    petRankedActiveKey,
    petRankedTokenKey,
    PET_RANKED_TOKEN_TTL_SECONDS,
    type ServerResolvedPetRankedToken,
} from './_ranked-engine.js';

/** Completed evidence remains replayable, but cannot grow without bound. */
export const PET_RANKED_REPLAY_TTL_SECONDS = 24 * 60 * 60;
export const PET_RANKED_JOURNAL_VERSION = 'pet-ranked-settlement-journal-v1' as const;
const MAX_PET_RANKED_JOURNAL_BYTES = 256 * 1024;

export type PetRankedJournalRating = {
    field: 'petRankedRating';
    value: number;
    delta: number;
};

export type PetRankedSettlementJournal = {
    version: typeof PET_RANKED_JOURNAL_VERSION;
    state: 'pending' | 'completed';
    matchId: string;
    tokenFingerprint: string;
    token: ServerResolvedPetRankedToken;
    /** Ranked active leases are non-expiring from their initial NX claim. */
    leasesDurable: true;
    confirmed: { a: boolean; b: boolean };
    createdAt: number;
    updatedAt: number;
    attempts: number;
    completedAt?: number;
    ratings?: { a: PetRankedJournalRating; b: PetRankedJournalRating };
};

type JournalStore = Pick<KvLike, 'get' | 'set' | 'compareSet' | 'delIfEqual'>;
type StoredJournal = {
    record: PetRankedSettlementJournal;
    pendingSerialized: string | null;
    completedSerialized: string | null;
};

export function petRankedJournalKey(matchId: string): string {
    return `pet:ranked-journal:${matchId}`;
}

export function petRankedJournalCompletedKey(matchId: string): string {
    return `pet:ranked-journal:${matchId}:completed`;
}

export function petRankedJournalLockKey(matchId: string): string {
    return `pet:ranked-journal-lock:${matchId}`;
}

export function petRankedRecoveryKey(playerName: string): string {
    return `pet:ranked-recovery:${safeName(playerName)}`;
}

function petRankedConfirmationKey(matchId: string, side: 'a' | 'b'): string {
    return `pet:ranked-journal:${matchId}:confirmed:${side}`;
}

export function petRankedTokenFingerprint(token: ServerResolvedPetRankedToken): string {
    const material = [
        token.version,
        token.matchId,
        safeName(token.a),
        safeName(token.b),
        token.aRating,
        token.bRating,
        token.createdAt,
        token.seed,
        token.aPetId,
        token.bPetId,
        token.resolution?.authority,
        token.resolution?.engineVersion,
        token.resolution?.winner,
        token.resolution?.resolvedAt,
        token.resolution?.engineDigest,
        token.resolution?.reward?.kind,
        token.resolution?.reward?.ryo,
        token.resolution?.reward?.aDelta,
        token.resolution?.reward?.bDelta,
    ];
    return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

function journalMatches(
    value: unknown,
    matchId: string,
    expectedFingerprint?: string,
): value is PetRankedSettlementJournal {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as PetRankedSettlementJournal;
    const exactKeys = (candidate: unknown, keys: readonly string[]) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
        const actual = Object.keys(candidate).sort();
        const expected = [...keys].sort();
        return actual.length === expected.length
            && actual.every((key, index) => key === expected[index]);
    };
    const expectedKeys = [
        'version', 'state', 'matchId', 'tokenFingerprint', 'token', 'leasesDurable',
        'confirmed', 'createdAt', 'updatedAt', 'attempts',
        ...(record.state === 'completed' ? ['completedAt', 'ratings'] : []),
    ];
    if (record.version !== PET_RANKED_JOURNAL_VERSION
        || (record.state !== 'pending' && record.state !== 'completed')
        || !exactKeys(record, expectedKeys)
        || record.matchId !== matchId
        || !isPetRankedMatchId(record.matchId)
        || !isServerResolvedPetRankedToken(record.token)
        || record.token.matchId !== matchId
        || !/^[a-f0-9]{64}$/.test(record.tokenFingerprint)
        || record.tokenFingerprint !== petRankedTokenFingerprint(record.token)
        || (expectedFingerprint && record.tokenFingerprint !== expectedFingerprint)
        || record.leasesDurable !== true
        || !exactKeys(record.confirmed, ['a', 'b'])
        || typeof record.confirmed?.a !== 'boolean'
        || typeof record.confirmed?.b !== 'boolean'
        || !Number.isSafeInteger(record.createdAt)
        || record.createdAt <= 0
        || !Number.isSafeInteger(record.updatedAt)
        || record.updatedAt < record.createdAt
        || !Number.isSafeInteger(record.attempts)
        || record.attempts < 1) {
        return false;
    }
    const names = [safeName(record.token.a), safeName(record.token.b)];
    if (!names[0] || !names[1] || names[0] === names[1]) return false;
    if (record.state === 'completed') {
        return record.confirmed.a
            && record.confirmed.b
            && Number.isSafeInteger(record.completedAt)
            && Number(record.completedAt) >= record.createdAt
            && exactKeys(record.ratings, ['a', 'b'])
            && exactKeys(record.ratings?.a, ['field', 'value', 'delta'])
            && record.ratings?.a?.field === 'petRankedRating'
            && Number.isSafeInteger(record.ratings.a.value)
            && record.ratings.a.value >= 0
            && Number.isSafeInteger(record.ratings.a.delta)
            && exactKeys(record.ratings?.b, ['field', 'value', 'delta'])
            && record.ratings?.b?.field === 'petRankedRating'
            && Number.isSafeInteger(record.ratings.b.value)
            && record.ratings.b.value >= 0
            && Number.isSafeInteger(record.ratings.b.delta);
    }
    return !record.confirmed.a
        && !record.confirmed.b
        && record.completedAt === undefined
        && record.ratings === undefined;
}

function serializeJournal(record: PetRankedSettlementJournal): string {
    return JSON.stringify(record);
}

function parseJournal(
    raw: unknown,
    matchId: string,
    expectedState: 'pending' | 'completed',
    expectedFingerprint?: string,
): PetRankedSettlementJournal {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PET_RANKED_JOURNAL_BYTES) {
        throw new Error('pet-ranked-journal-invalid');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('pet-ranked-journal-invalid');
    }
    if (!journalMatches(parsed, matchId, expectedFingerprint) || parsed.state !== expectedState) {
        throw new Error('pet-ranked-journal-invalid');
    }
    return parsed;
}

/**
 * Pending authority is an immutable JSON string. Progress and completion use
 * append-only companion keys, so no update ever deletes the sole authority in
 * order to refresh a TTL or race a stale lock holder.
 */
async function readStoredJournal(
    store: Pick<KvLike, 'get'>,
    matchId: string,
    expectedFingerprint?: string,
): Promise<StoredJournal | null> {
    const [completedRaw, pendingRaw] = await Promise.all([
        store.get<unknown>(petRankedJournalCompletedKey(matchId)),
        store.get<unknown>(petRankedJournalKey(matchId)),
    ]);
    if (completedRaw !== null) {
        const completed = parseJournal(completedRaw, matchId, 'completed', expectedFingerprint);
        if (pendingRaw !== null) {
            parseJournal(pendingRaw, matchId, 'pending', completed.tokenFingerprint);
        }
        return {
            record: completed,
            pendingSerialized: typeof pendingRaw === 'string' ? pendingRaw : null,
            completedSerialized: completedRaw as string,
        };
    }
    if (pendingRaw === null) return null;
    const pending = parseJournal(pendingRaw, matchId, 'pending', expectedFingerprint);
    const [aConfirmation, bConfirmation] = await Promise.all([
        store.get<string>(petRankedConfirmationKey(matchId, 'a')),
        store.get<string>(petRankedConfirmationKey(matchId, 'b')),
    ]);
    for (const confirmation of [aConfirmation, bConfirmation]) {
        if (confirmation !== null && confirmation !== pending.tokenFingerprint) {
            throw new Error('pet-ranked-journal-confirmation-invalid');
        }
    }
    return {
        record: {
            ...pending,
            confirmed: {
                a: aConfirmation === pending.tokenFingerprint,
                b: bConfirmation === pending.tokenFingerprint,
            },
        },
        pendingSerialized: pendingRaw as string,
        completedSerialized: null,
    };
}

async function requireSetWithExactReadback(
    store: Pick<KvLike, 'get' | 'set'>,
    key: string,
    value: unknown,
    options?: { ex?: number; nx?: boolean },
): Promise<void> {
    try {
        const written = await store.set(key, value, options);
        if (written === 'OK') return;
    } catch (error) {
        const stored = await store.get<unknown>(key).catch(() => null);
        if (isDeepStrictEqual(stored, value)) return;
        throw error;
    }
    const stored = await store.get<unknown>(key).catch(() => null);
    if (isDeepStrictEqual(stored, value)) return;
    throw new Error('pet-ranked-journal-write-unconfirmed');
}

/** Claim only a missing row; an existing owned row is never delete-refreshed. */
async function claimMissingExact(
    store: JournalStore,
    key: string,
    value: string,
    conflictError: string,
): Promise<void> {
    const current = await store.get<string>(key);
    if (current === value) return;
    if (current !== null) throw new Error(conflictError);
    try {
        await requireSetWithExactReadback(store, key, value, { nx: true });
    } catch (error) {
        const after = await store.get<string>(key).catch(() => null);
        if (after !== null && after !== value) throw new Error(conflictError);
        throw error;
    }
}

/**
 * Completion atomically turns an owned durable row into a bounded
 * acknowledgement. Full-value CAS removes the former delete/re-add gap: no
 * foreign mode can slip in and no paused completion can shorten another owner.
 */
async function boundOwnedValue(
    store: JournalStore,
    key: string,
    value: string,
    ttlSeconds: number,
): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await store.get<string>(key);
        if (current !== null && current !== value) return;
        if (current === null) {
            try {
                await requireSetWithExactReadback(store, key, value, { nx: true, ex: ttlSeconds });
                return;
            } catch (error) {
                const after = await store.get<string>(key).catch(() => null);
                if (after !== null && after !== value) return;
                throw error;
            }
        }
        try {
            if (await store.compareSet(key, value, value, { ex: ttlSeconds })) return;
        } catch (error) {
            // Retrying expected===replacement is idempotent and confirms the TTL
            // after a commit-with-lost-ack; readback alone cannot prove expiry.
            const after = await store.get<string>(key).catch(() => null);
            if (after !== value) {
                if (after !== null) return;
                throw error;
            }
        }
    }
    throw new Error('pet-ranked-completion-lease-transition-unconfirmed');
}

async function requireDeleteExactOrAbsent(
    store: Pick<KvLike, 'get' | 'delIfEqual'>,
    key: string,
    expected: string,
): Promise<void> {
    try {
        if (await store.delIfEqual(key, expected)) return;
    } catch (error) {
        const stored = await store.get<unknown>(key).catch(() => expected);
        if (stored === null) return;
        throw error;
    }
    const stored = await store.get<unknown>(key);
    if (stored === null) return;
    if (stored === expected) throw new Error('pet-ranked-journal-cleanup-unconfirmed');
    throw new Error('pet-ranked-journal-cleanup-conflict');
}

/** Load authority after the short public token expires. */
export async function loadPetRankedAuthorityToken(
    store: Pick<KvLike, 'get'>,
    matchId: string,
): Promise<ServerResolvedPetRankedToken | null> {
    if (!isPetRankedMatchId(matchId)) return null;
    const journal = await readStoredJournal(store, matchId);
    if (journal) return journal.record.token;
    const token = await store.get<unknown>(petRankedTokenKey(matchId));
    if (token === null) return null;
    if (!isServerResolvedPetRankedToken(token) || token.matchId !== matchId) {
        throw new Error('pet-ranked-token-invalid');
    }
    return token;
}

/**
 * Reserve immutable recovery before either save moves. Initial ranked active
 * leases already have no TTL; this function verifies or NX-restores missing
 * owned rows without ever deleting an unresolved gate.
 */
export async function preparePetRankedJournal(
    store: JournalStore,
    token: ServerResolvedPetRankedToken,
    now = Date.now(),
): Promise<PetRankedSettlementJournal> {
    if (!isServerResolvedPetRankedToken(token)) throw new Error('pet-ranked-journal-invalid-token');
    const fingerprint = petRankedTokenFingerprint(token);
    const timestamp = Number.isFinite(now) ? Math.max(1, Math.floor(now)) : Date.now();
    const proposed: PetRankedSettlementJournal = {
        version: PET_RANKED_JOURNAL_VERSION,
        state: 'pending',
        matchId: token.matchId,
        tokenFingerprint: fingerprint,
        token,
        leasesDurable: true,
        confirmed: { a: false, b: false },
        createdAt: timestamp,
        updatedAt: timestamp,
        attempts: 1,
    };
    let stored = await readStoredJournal(store, token.matchId, fingerprint);
    if (!stored) {
        await requireSetWithExactReadback(
            store,
            petRankedJournalKey(token.matchId),
            serializeJournal(proposed),
            { nx: true },
        );
        stored = await readStoredJournal(store, token.matchId, fingerprint);
    }
    if (!stored) throw new Error('pet-ranked-journal-reservation-unreadable');
    if (stored.record.state === 'completed') return stored.record;

    for (const player of [safeName(token.a), safeName(token.b)]) {
        await claimMissingExact(
            store,
            petRankedActiveKey(player),
            token.matchId,
            'pet-ranked-journal-active-conflict',
        );
    }
    for (const player of [safeName(token.a), safeName(token.b)]) {
        await claimMissingExact(
            store,
            petRankedRecoveryKey(player),
            token.matchId,
            'pet-ranked-journal-recovery-conflict',
        );
    }
    return (await readStoredJournal(store, token.matchId, fingerprint))!.record;
}

export async function markPetRankedJournalConfirmation(
    store: JournalStore,
    matchId: string,
    confirmation: { a: boolean; b: boolean },
    _now = Date.now(),
): Promise<PetRankedSettlementJournal> {
    const stored = await readStoredJournal(store, matchId);
    if (!stored) throw new Error('pet-ranked-journal-missing');
    if (stored.record.state === 'completed') return stored.record;
    const fingerprint = stored.record.tokenFingerprint;
    for (const side of ['a', 'b'] as const) {
        if (confirmation[side]) {
            await requireSetWithExactReadback(
                store,
                petRankedConfirmationKey(matchId, side),
                fingerprint,
                { nx: true },
            );
        }
    }
    return (await readStoredJournal(store, matchId, fingerprint))!.record;
}

/**
 * Publish bounded completed evidence before shortening any lease. Only after
 * every compaction write is acknowledged (or exactly read back) are immutable
 * pending authority and progress keys compare-deleted.
 */
export async function compactPetRankedJournal(
    store: JournalStore,
    matchId: string,
    ratings: { a: PetRankedJournalRating; b: PetRankedJournalRating },
    now = Date.now(),
): Promise<PetRankedSettlementJournal> {
    const stored = await readStoredJournal(store, matchId);
    if (!stored) throw new Error('pet-ranked-journal-missing');
    const timestamp = Number.isFinite(now) ? Math.max(1, Math.floor(now)) : Date.now();
    const completed: PetRankedSettlementJournal = stored.record.state === 'completed'
        ? stored.record
        : {
            ...stored.record,
            state: 'completed',
            confirmed: { a: true, b: true },
            ratings,
            completedAt: timestamp,
            updatedAt: timestamp,
            attempts: stored.record.attempts + 1,
        };
    const elapsedSeconds = Math.max(0, Math.floor((timestamp - Number(completed.completedAt ?? timestamp)) / 1_000));
    const replayTtl = Math.max(1, PET_RANKED_REPLAY_TTL_SECONDS - elapsedSeconds);
    const completedSerialized = serializeJournal(completed);
    if (stored.completedSerialized === null) {
        await requireSetWithExactReadback(
            store,
            petRankedJournalCompletedKey(matchId),
            completedSerialized,
            { nx: true, ex: replayTtl },
        );
    } else if (stored.completedSerialized !== completedSerialized) {
        throw new Error('pet-ranked-journal-completion-conflict');
    }

    // The completed journal embeds the full token. The legacy token row is
    // recreated only when absent; a mismatched value is never overwritten.
    const existingToken = await store.get<unknown>(petRankedTokenKey(matchId));
    if (existingToken === null) {
        await requireSetWithExactReadback(
            store,
            petRankedTokenKey(matchId),
            completed.token,
            { nx: true, ex: replayTtl },
        );
    } else if (!isDeepStrictEqual(existingToken, completed.token)) {
        throw new Error('pet-ranked-token-compaction-conflict');
    }

    for (const player of [safeName(completed.token.a), safeName(completed.token.b)]) {
        await boundOwnedValue(store, petRankedActiveKey(player), matchId, PET_RANKED_TOKEN_TTL_SECONDS);
        // Recovery discovery is only needed while unresolved. Completed replay
        // is discoverable through the bounded active row and completed journal;
        // retaining recovery here would make a new queue pairing resume the old
        // match after battle-result has acknowledged and cleared active.
        await requireDeleteExactOrAbsent(store, petRankedRecoveryKey(player), matchId);
    }

    if (stored.pendingSerialized !== null) {
        await requireDeleteExactOrAbsent(store, petRankedJournalKey(matchId), stored.pendingSerialized);
    }
    for (const side of ['a', 'b'] as const) {
        await requireDeleteExactOrAbsent(
            store,
            petRankedConfirmationKey(matchId, side),
            completed.tokenFingerprint,
        );
    }
    return completed;
}

export async function getPetRankedJournal(
    store: Pick<KvLike, 'get'>,
    matchId: string,
): Promise<PetRankedSettlementJournal | null> {
    return (await readStoredJournal(store, matchId))?.record ?? null;
}

/**
 * Enumerate only exact pending-authority rows. Completed journals and their
 * confirmation/lock companion keys deliberately do not match this filter.
 * A malformed exact row throws through getPetRankedJournal so rollover fails
 * closed instead of silently advancing a season over corrupt authority.
 */
export async function listPendingPetRankedJournals(
    store: Pick<KvLike, 'get' | 'keys'>,
): Promise<PetRankedSettlementJournal[]> {
    const keys = await store.keys('pet:ranked-journal:*');
    const matchIds = keys
        .map((key) => /^pet:ranked-journal:([a-f0-9]{32})$/.exec(key)?.[1] ?? '')
        .filter(isPetRankedMatchId)
        .sort();
    const journals: PetRankedSettlementJournal[] = [];
    for (const matchId of matchIds) {
        const journal = await getPetRankedJournal(store, matchId);
        if (!journal) throw new Error('pet-ranked-pending-journal-disappeared');
        if (journal.state === 'pending') journals.push(journal);
    }
    return journals;
}
