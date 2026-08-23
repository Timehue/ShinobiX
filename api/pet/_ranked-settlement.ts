import { createHash } from 'node:crypto';
import { creditRankedOutcome, DEFAULT_RANKED_RATING, rankedDelta } from '../_ranked-rating.js';
import {
    appendSettlementReceipt,
    inspectSettlementReceipt,
} from '../_settlement-receipts.js';
import type { KvLike } from '../_storage.js';
import { mergePreservingImages, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    isPetRankedMatchId,
    PET_RANKED_ENGINE_VERSION,
    type ServerResolvedPetRankedToken,
} from './_ranked-engine.js';
import {
    compactPetRankedJournal,
    markPetRankedJournalConfirmation,
    petRankedJournalLockKey,
    preparePetRankedJournal,
    type PetRankedSettlementJournal,
} from './_ranked-journal.js';

export type { ServerResolvedPetRankedToken } from './_ranked-engine.js';

export const PET_RANKED_DISABLED_REASON = 'ranked-pet-server-authority-required';
export const PET_RANKED_PUBLIC_PRESENTATION_DISABLED_REASON = 'ranked-pet-public-presentation-required';
export const PET_RANKED_QUEUE_DISABLED_REASON = 'Ranked pet matchmaking is temporarily unavailable.';

/*
 * ROLLOUT STATE.
 *
 * These were three stacked POSITIVE flags from the era when ranked pet combat
 * resolved twice, by two engines over two seeds, so a watched victory could be
 * recorded as a loss. That defect is gone: resolveRankedPetDuel is the single
 * resolution and ranked-watch replays that exact fight to both players.
 *
 * They are now opt-OUT kill switches, matching every switch in _release-flags.ts
 * — the mode ships on and an incident closes it. The previous positive flags
 * were also referenced by nothing but their own unit test, so nothing shipped
 * behind them either way.
 */

/** Server-authoritative ranked pet resolution. Opt-out only. */
export function petRankedStartsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_PET_RANKED_SERVER_V1 !== '1';
}

/** Live ranked matchmaking (api/pet/ranked-queue.ts). Inherits the core switch. */
export function petRankedQueueEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return petRankedStartsEnabled(env) && env.DISABLE_PET_RANKED_QUEUE !== '1';
}

/**
 * The retired legacy `rankedPet` CHALLENGE record stays closed on its own
 * switch. Its client displayed one engine while settlement replayed another, so
 * it is not covered by the fix above and must be re-opened deliberately.
 */
export function petRankedPublicChallengesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return petRankedStartsEnabled(env)
        && env.ENABLE_PET_RANKED_PUBLIC_CHALLENGES_V1 === '1';
}

/** Public ranked presentation surfaces. Inherits the core switch. */
export function petRankedPublicPresentationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return petRankedStartsEnabled(env) && env.DISABLE_PET_RANKED_PUBLIC_PRESENTATION !== '1';
}

export type PetRankedSettlement = {
    callerRole: 'winner' | 'loser' | 'draw';
    authoritativeOutcome: 'win' | 'loss' | 'draw';
    aName: string;
    bName: string;
    aRating: number;
    bRating: number;
    winnerName?: string;
    loserName?: string;
    winnerRating?: number;
    loserRating?: number;
};

export type PetRankedSettlementDecision =
    | { ok: true; settlement: PetRankedSettlement }
    | {
        ok: false;
        reason: 'server-resolution-required' | 'invalid-server-resolution' | 'caller-not-in-match' | 'conflicting-client-outcome';
    };

export type PetRankedSideSettlementResult =
    | {
        status: 'settled' | 'replay';
        rating: { field: 'petRankedRating'; value: number; delta: number };
        record: Record<string, unknown>;
    }
    | { status: 'missing-save' | 'invalid-receipts' };

export type PetRankedSideSettlementInput = {
    playerName: string;
    matchToken: string;
    role: 'winner' | 'loser' | 'draw';
    winnerRating: number;
    loserRating: number;
    combatPetId?: string;
    now?: number;
};

type PetRankedSettlementStamp = {
    settlementId: string;
    fingerprint: string;
    rating: { field: 'petRankedRating'; value: number; delta: number };
    settledAt: number;
};

function inspectPetRankedStamp(
    character: Record<string, unknown>,
    settlementId: string,
    fingerprint: string,
): { status: 'absent' | 'conflict' } | { status: 'replay'; stamp: PetRankedSettlementStamp } {
    const raw = character.petRankedSettlementStamp;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 'absent' };
    const record = raw as Record<string, unknown>;
    if (record.settlementId !== settlementId) return { status: 'absent' };
    const rating = record.rating;
    const topKeys = Object.keys(record).sort();
    const ratingKeys = rating && typeof rating === 'object' && !Array.isArray(rating)
        ? Object.keys(rating as Record<string, unknown>).sort()
        : [];
    const ratingRecord = rating as Record<string, unknown> | null;
    if (!/^pet-ranked-[a-f0-9]{48}$/.test(settlementId)
        || topKeys.join('|') !== 'fingerprint|rating|settledAt|settlementId'
        || ratingKeys.join('|') !== 'delta|field|value'
        || record.fingerprint !== fingerprint
        || ratingRecord?.field !== 'petRankedRating'
        || !Number.isSafeInteger(ratingRecord.value)
        || Number(ratingRecord.value) < 0
        || !Number.isSafeInteger(ratingRecord.delta)
        || !Number.isSafeInteger(record.settledAt)
        || Number(record.settledAt) <= 0) {
        return { status: 'conflict' };
    }
    return { status: 'replay', stamp: record as PetRankedSettlementStamp };
}

export type PetRankedLockRunner = <T>(key: string, action: () => Promise<T>) => Promise<T>;

export type PetRankedMatchSettlementResult = {
    a: PetRankedSideSettlementResult & { status: 'settled' | 'replay' };
    b: PetRankedSideSettlementResult & { status: 'settled' | 'replay' };
};

/**
 * Derive the settlement exclusively from a private, server-resolved token.
 * `reportedOutcome` is never an input to winner selection; it is only checked
 * so a stale/conflicting client gets a clear 409 instead of silently showing the
 * opposite result.
 */
export function derivePetRankedSettlement(
    token: ServerResolvedPetRankedToken,
    callerName: string,
    reportedOutcome?: 'win' | 'loss' | 'draw',
): PetRankedSettlementDecision {
    const resolution = token?.resolution;
    if (!resolution || resolution.authority !== 'server-engine-v1') {
        return { ok: false, reason: 'server-resolution-required' };
    }
    if (token.version !== 'pet-ranked-token-v1'
        || !isPetRankedMatchId(token.matchId)
        || !Number.isSafeInteger(token.seed)
        || token.seed < 1
        || token.seed > 0x7fffffff
        || (resolution.winner !== 'a' && resolution.winner !== 'b' && resolution.winner !== 'draw')
        || resolution.engineVersion !== PET_RANKED_ENGINE_VERSION
        || !Number.isFinite(resolution.resolvedAt)
        || resolution.resolvedAt < token.createdAt
        || typeof resolution.engineDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(resolution.engineDigest)) {
        return { ok: false, reason: 'invalid-server-resolution' };
    }

    const a = safeName(token.a);
    const b = safeName(token.b);
    const caller = safeName(callerName);
    if (!a || !b || a === b || (caller !== a && caller !== b)) {
        return { ok: false, reason: 'caller-not-in-match' };
    }
    const aRating = Number(token.aRating);
    const bRating = Number(token.bRating);
    if (!Number.isFinite(aRating)
        || !Number.isFinite(bRating)
        || aRating < 0
        || bRating < 0
        || typeof token.aPetId !== 'string'
        || token.aPetId.length < 1
        || token.aPetId.length > 80
        || typeof token.bPetId !== 'string'
        || token.bPetId.length < 1
        || token.bPetId.length > 80) {
        return { ok: false, reason: 'invalid-server-resolution' };
    }

    const delta = resolution.winner === 'a'
        ? rankedDelta(aRating, bRating)
        : resolution.winner === 'b'
            ? rankedDelta(bRating, aRating)
            : 0;
    const expectedA = resolution.winner === 'a' ? delta : resolution.winner === 'b' ? -delta : 0;
    const expectedB = -expectedA;
    if (resolution.reward?.kind !== 'pet-rating-v1'
        || resolution.reward.ryo !== 0
        || resolution.reward.aDelta !== expectedA
        || resolution.reward.bDelta !== expectedB) {
        return { ok: false, reason: 'invalid-server-resolution' };
    }

    if (resolution.winner === 'draw') {
        const authoritativeOutcome = 'draw' as const;
        if (reportedOutcome !== undefined && reportedOutcome !== authoritativeOutcome) {
            return { ok: false, reason: 'conflicting-client-outcome' };
        }
        return {
            ok: true,
            settlement: {
                callerRole: 'draw',
                authoritativeOutcome,
                aName: a,
                bName: b,
                aRating,
                bRating,
            },
        };
    }

    const winnerName = resolution.winner === 'a' ? a : b;
    const loserName = resolution.winner === 'a' ? b : a;
    const winnerRating = resolution.winner === 'a' ? aRating : bRating;
    const loserRating = resolution.winner === 'a' ? bRating : aRating;
    const authoritativeOutcome: 'win' | 'loss' = caller === winnerName ? 'win' : 'loss';
    if (reportedOutcome !== undefined && reportedOutcome !== authoritativeOutcome) {
        return { ok: false, reason: 'conflicting-client-outcome' };
    }

    return {
        ok: true,
        settlement: {
            callerRole: authoritativeOutcome === 'win' ? 'winner' : 'loser',
            authoritativeOutcome,
            aName: a,
            bName: b,
            aRating,
            bRating,
            winnerName,
            loserName,
            winnerRating,
            loserRating,
        },
    };
}

/**
 * Stable, bounded receipt id for one private match token. The token itself is
 * never copied into the player save; hashing prevents malformed/long legacy
 * values from colliding after a string slice.
 */
export function petRankedSettlementId(matchToken: string): string | null {
    const token = String(matchToken ?? '').trim();
    if (token.length < 16 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const digest = createHash('sha256').update(`pet-ranked-v1:${token}`).digest('hex').slice(0, 48);
    return `pet-ranked-${digest}`;
}

/**
 * Settle one fighter while the caller holds that player's save lock.
 *
 * Rating/counters, consumable cleanup, and the idempotency receipt are embedded
 * in the same save object and committed by one exact full-record CAS. Therefore:
 *   - failure before commit leaves no receipt and retry remains fresh;
 *   - a lost acknowledgement after commit leaves credit + receipt together and
 *     retry observes a replay rather than applying the Elo swing twice.
 *
 * The two fighters live in separate save rows, so the endpoint settles each
 * independently under both locks. If side two fails, retry sees side one as a
 * replay and can safely finish side two.
 */
async function settlePetRankedSideOnce(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    input: PetRankedSideSettlementInput,
): Promise<PetRankedSideSettlementResult | { status: 'retry' }> {
    const playerName = safeName(input.playerName);
    const settlementId = petRankedSettlementId(input.matchToken);
    if (!playerName
        || !settlementId
        || !Number.isFinite(input.winnerRating)
        || !Number.isFinite(input.loserRating)) {
        return { status: 'invalid-receipts' };
    }

    const saveKey = `save:${playerName}`;
    const record = await store.get<Record<string, unknown>>(saveKey);
    const character = (record?.character ?? null) as Record<string, unknown> | null;
    if (!record || !character) return { status: 'missing-save' };

    const fingerprint = `pet-rating-${input.role}`;
    const stampInspection = inspectPetRankedStamp(character, settlementId, fingerprint);
    if (stampInspection.status === 'replay') {
        return { status: 'replay', rating: stampInspection.stamp.rating, record };
    }
    if (stampInspection.status === 'conflict') return { status: 'invalid-receipts' };
    const inspection = inspectSettlementReceipt(character, settlementId, fingerprint);
    const currentRating = Number(character.petRankedRating);
    const normalizedCurrentRating = Number.isFinite(currentRating)
        ? Math.max(0, currentRating)
        : DEFAULT_RANKED_RATING;
    const ranked = input.role === 'draw'
        ? { patch: {}, newRating: normalizedCurrentRating, delta: 0 }
        : creditRankedOutcome(character, {
            role: input.role,
            winnerRating: input.winnerRating,
            loserRating: input.loserRating,
            kind: 'pet',
        });
    const rating = {
        field: 'petRankedRating' as const,
        value: normalizedCurrentRating,
        delta: ranked.delta,
    };

    if (inspection.status === 'replay') {
        return { status: 'replay', rating, record };
    }
    if (inspection.status !== 'fresh') return { status: 'invalid-receipts' };

    const combatPetId = String(input.combatPetId ?? '');
    const pets = Array.isArray(character.pets)
        ? character.pets as Array<Record<string, unknown>>
        : [];
    const nextPets = pets.map((pet) =>
        combatPetId
        && String(pet?.id ?? '') === combatPetId
        && pet.loadout
        && typeof pet.loadout === 'object'
            ? { ...pet, loadout: { ...(pet.loadout as Record<string, unknown>), consumable: undefined } }
            : pet,
    );
    const now = Number(input.now ?? Date.now());
    const settledAt = Number.isFinite(now) ? Math.max(1, Math.floor(now)) : Date.now();
    const credited = appendSettlementReceipt(
        {
            ...character,
            ...ranked.patch,
            pets: nextPets,
            // Dedicated single-match stamp is outside the shared bounded receipt
            // ring. An unresolved ranked lease prevents a newer ranked match, so
            // unrelated settlement churn cannot evict partial-match authority.
            petRankedSettlementStamp: {
                settlementId,
                fingerprint,
                rating: { field: 'petRankedRating', value: ranked.newRating, delta: ranked.delta },
                settledAt,
            } satisfies PetRankedSettlementStamp,
        },
        inspection.receipts,
        {
            requestId: settlementId,
            fingerprint,
            value: { settled: 1 },
            settledAt,
        },
    );
    const nextRecord = mergePreservingImages(
        bumpSaveVersion({ ...record, character: credited }),
        record,
    ) as Record<string, unknown>;
    try {
        if (!await store.compareSet(saveKey, record, nextRecord)) return { status: 'retry' };
    } catch (error) {
        const recovered = await store.get<Record<string, unknown>>(saveKey).catch(() => null);
        const recoveredCharacter = (recovered?.character ?? null) as Record<string, unknown> | null;
        if (recovered && recoveredCharacter) {
            const recoveredStamp = inspectPetRankedStamp(recoveredCharacter, settlementId, fingerprint);
            if (recoveredStamp.status === 'replay') {
                return { status: 'settled', rating: recoveredStamp.stamp.rating, record: recovered };
            }
        }
        throw error;
    }

    return {
        status: 'settled',
        rating: { ...rating, value: ranked.newRating },
        record: nextRecord,
    };
}

export async function settlePetRankedSide(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    input: PetRankedSideSettlementInput,
): Promise<PetRankedSideSettlementResult> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const result = await settlePetRankedSideOnce(store, input);
        if (result.status !== 'retry') return result;
    }
    throw new Error('pet-ranked-save-cas-busy');
}

/**
 * Settle both sides from one private server token. Callers provide a fail-closed
 * lock runner; deterministic key ordering prevents reciprocal result reports
 * from deadlocking. Each save remains independently retryable after a partial
 * two-row failure because its rating patch and receipt are one write.
 */
export async function settlePetRankedMatch(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    input: {
        matchToken: string;
        token: ServerResolvedPetRankedToken;
        lock: PetRankedLockRunner;
        now?: number;
    },
): Promise<PetRankedMatchSettlementResult> {
    if (input.token.matchId !== input.matchToken) throw new Error('pet-ranked-token-key-mismatch');
    const decision = derivePetRankedSettlement(input.token, input.token.a);
    if (!decision.ok) throw new Error(`pet-ranked-${decision.reason}`);
    const settlement = decision.settlement;
    const aRole: 'winner' | 'loser' | 'draw' = settlement.authoritativeOutcome === 'draw'
        ? 'draw'
        : settlement.winnerName === settlement.aName ? 'winner' : 'loser';
    const bRole: 'winner' | 'loser' | 'draw' = aRole === 'draw'
        ? 'draw'
        : aRole === 'winner' ? 'loser' : 'winner';
    const ratings = aRole === 'draw'
        ? { winnerRating: settlement.aRating, loserRating: settlement.bRating }
        : {
            winnerRating: settlement.winnerRating!,
            loserRating: settlement.loserRating!,
        };
    const settle = async (
        playerName: string,
        role: 'winner' | 'loser' | 'draw',
        combatPetId: string,
    ): Promise<PetRankedSideSettlementResult & { status: 'settled' | 'replay' }> => {
        const result = await settlePetRankedSide(store, {
            playerName,
            matchToken: input.matchToken,
            role,
            ...ratings,
            combatPetId,
            now: input.now,
        });
        if (result.status !== 'settled' && result.status !== 'replay') {
            throw new Error(`pet-ranked-${playerName}-${result.status}`);
        }
        return result;
    };

    const [key1, key2] = [`save:${settlement.aName}`, `save:${settlement.bName}`].sort();
    return input.lock(key1, () => input.lock(key2, async () => {
        const a = await settle(settlement.aName, aRole, input.token.aPetId);
        const b = await settle(settlement.bName, bRole, input.token.bPetId);
        return { a, b };
    }));
}

function rolesForToken(token: ServerResolvedPetRankedToken): {
    a: 'winner' | 'loser' | 'draw';
    b: 'winner' | 'loser' | 'draw';
} {
    if (token.resolution.winner === 'draw') return { a: 'draw', b: 'draw' };
    return token.resolution.winner === 'a'
        ? { a: 'winner', b: 'loser' }
        : { a: 'loser', b: 'winner' };
}

async function inspectJournalReceipts(
    store: Pick<KvLike, 'get'>,
    token: ServerResolvedPetRankedToken,
): Promise<{ a: boolean; b: boolean }> {
    const settlementId = petRankedSettlementId(token.matchId);
    if (!settlementId) return { a: false, b: false };
    const roles = rolesForToken(token);
    const [aRecord, bRecord] = await Promise.all([
        store.get<Record<string, unknown>>(`save:${safeName(token.a)}`),
        store.get<Record<string, unknown>>(`save:${safeName(token.b)}`),
    ]);
    const receipt = (record: Record<string, unknown> | null, role: 'winner' | 'loser' | 'draw') => {
        const character = (record?.character ?? null) as Record<string, unknown> | null;
        if (!character) return false;
        const fingerprint = `pet-rating-${role}`;
        if (inspectPetRankedStamp(character, settlementId, fingerprint).status === 'replay') return true;
        return inspectSettlementReceipt(character, settlementId, fingerprint).status === 'replay';
    };
    return { a: receipt(aRecord, roles.a), b: receipt(bRecord, roles.b) };
}

async function replayCompletedJournal(
    store: Pick<KvLike, 'get'>,
    journal: PetRankedSettlementJournal,
): Promise<PetRankedMatchSettlementResult> {
    if (journal.state !== 'completed' || !journal.ratings) {
        throw new Error('pet-ranked-completed-journal-invalid');
    }
    const [aRecord, bRecord] = await Promise.all([
        store.get<Record<string, unknown>>(`save:${safeName(journal.token.a)}`),
        store.get<Record<string, unknown>>(`save:${safeName(journal.token.b)}`),
    ]);
    if (!aRecord || !bRecord) throw new Error('pet-ranked-completed-save-missing');
    return {
        a: { status: 'replay', rating: journal.ratings.a, record: aRecord },
        b: { status: 'replay', rating: journal.ratings.b, record: bRecord },
    };
}

/**
 * Durable two-save orchestration. Pending authority, per-player discovery, and
 * both shared active rows have no TTL until both embedded save receipts are
 * observed. Completion then compacts authority to bounded replay evidence.
 */
export async function settlePetRankedMatchDurably(
    store: Pick<KvLike, 'get' | 'set' | 'compareSet' | 'delIfEqual'>,
    input: {
        matchToken: string;
        token: ServerResolvedPetRankedToken;
        lock: PetRankedLockRunner;
        now?: number;
    },
): Promise<PetRankedMatchSettlementResult> {
    return input.lock(petRankedJournalLockKey(input.matchToken), async () => {
        const journal = await preparePetRankedJournal(store, input.token, input.now);
        if (journal.state === 'completed') {
            // Completion publication precedes token/lease compaction. A storage
            // fault after publication must resume those idempotent tail steps;
            // returning replay immediately would strand durable leases forever.
            await compactPetRankedJournal(store, input.matchToken, journal.ratings!, input.now);
            return replayCompletedJournal(store, journal);
        }
        try {
            const result = await settlePetRankedMatch(store, input);
            await compactPetRankedJournal(store, input.matchToken, {
                a: result.a.rating,
                b: result.b.rating,
            }, input.now);
            return result;
        } catch (error) {
            // A side whose write committed but whose acknowledgement was lost is
            // confirmed by its in-save receipt. Progress is evidence only; the
            // pending journal remains authoritative until a later retry sees both.
            const confirmation = await inspectJournalReceipts(store, input.token)
                .catch(() => journal.confirmed);
            await markPetRankedJournalConfirmation(store, input.matchToken, confirmation, input.now)
                .catch(() => undefined);
            throw error;
        }
    });
}
