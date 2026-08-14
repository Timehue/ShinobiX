import { createHash } from 'node:crypto';
import { activeCarriedPets } from '../_entitlements.js';
import { DEFAULT_RANKED_RATING, rankedDelta } from '../_ranked-rating.js';
import { petJutsuPowerCeil, petStatCeil } from '../_pet-stat-ceil.js';
import { runPetDuel } from '../_pet-sim/pet-duel-sim.js';
import type { Pet, PetJutsu } from '../_pet-sim/pet-types.js';
import type { KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import { petCombatBusyReason } from './_pet-busy.js';

/**
 * Private ranked-pet authority primitives.
 *
 * The browser may render the returned seed, but it never supplies any input
 * used below. Pairing comes from the server queue, pets come from both saves,
 * and the deterministic server engine owns the resolution and rating reward.
 */

export const PET_RANKED_ENGINE_VERSION = 'pet-duel-sim-ranked-v1' as const;
export const PET_RANKED_TOKEN_TTL_SECONDS = 15 * 60;
export const PET_RANKED_QUEUE_MATCH_TTL_SECONDS = 90;
export const PET_RANKED_QUEUE_KEY = 'pvp:pet-ranked-queue';

const MATCH_ID = /^[a-f0-9]{32}$/;
const PET_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const JUTSU_KINDS = new Set<PetJutsu['kind']>([
    'damage', 'buff', 'heal', 'debuff', 'dot', 'move', 'barrier', 'movelock',
    'lifesteal', 'shield', 'absorb', 'burn', 'freeze', 'confuse', 'stun',
    'crush', 'wound', 'mark', 'slow', 'haste', 'taunt', 'push', 'pull',
]);
const RARITIES = new Set(['standard', 'rare', 'legendary', 'mythic']);
const ELEMENTS = new Set(['Earth', 'Wind', 'Lightning', 'Fire', 'Water', 'None']);

export type PetRankedQueueMatch = {
    matchId: string;
    opponent: string;
    opponentElo: number;
    opponentLevel: number;
    initiator: boolean;
    createdAt: number;
};

export type PetRankedRatingReward = {
    kind: 'pet-rating-v1';
    ryo: 0;
    aDelta: number;
    bDelta: number;
};

export type ServerResolvedPetRankedToken = {
    version: 'pet-ranked-token-v1';
    matchId: string;
    a: string;
    b: string;
    aRating: number;
    bRating: number;
    createdAt: number;
    seed: number;
    aPetId: string;
    bPetId: string;
    resolution: {
        authority: 'server-engine-v1';
        engineVersion: typeof PET_RANKED_ENGINE_VERSION;
        winner: 'a' | 'b' | 'draw';
        resolvedAt: number;
        engineDigest: string;
        reward: PetRankedRatingReward;
    };
};

export type AuthoritativeRankedPetChoice =
    | { ok: true; pet: Pet }
    | { ok: false; reason: 'missing-character' | 'no-entitled-pet' | 'all-entitled-pets-busy' };

export type PetRankedActiveClaim =
    | { ok: true; freshKeys: string[] }
    | { ok: false; conflictPlayer: string };

export function petRankedQueueMatchKey(playerName: string): string {
    return `${PET_RANKED_QUEUE_KEY}:match:${safeName(playerName)}`;
}

export function petRankedTokenKey(matchToken: string): string {
    return `pet:ranked-token:${matchToken}`;
}

export function petRankedActiveKey(playerName: string): string {
    // Share the lease with casual/Warfront combat and Sanctuary transfers. A pet
    // cannot be in two independently-settled modes at once.
    return `pet:battle-active:${safeName(playerName)}`;
}

const PET_RANKED_STARTING_PREFIX = 'pet-ranked-starting:';

export function petRankedStartingLeaseToken(matchId: string): string {
    if (!isPetRankedMatchId(matchId)) throw new Error('invalid-pet-ranked-starting-intent');
    return `${PET_RANKED_STARTING_PREFIX}${matchId}`;
}

export function petRankedMatchIdFromStartingLease(value: unknown): string | null {
    if (typeof value !== 'string' || !value.startsWith(PET_RANKED_STARTING_PREFIX)) return null;
    const matchId = value.slice(PET_RANKED_STARTING_PREFIX.length);
    return isPetRankedMatchId(matchId) ? matchId : null;
}

export function isPetRankedMatchId(value: unknown): value is string {
    return typeof value === 'string' && MATCH_ID.test(value);
}

function exactRecordKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const sortedExpected = [...expected].sort();
    return actual.length === sortedExpected.length
        && actual.every((key, index) => key === sortedExpected[index]);
}

/** Strict durable-token validator shared by preparations and journals. */
export function isServerResolvedPetRankedToken(value: unknown): value is ServerResolvedPetRankedToken {
    if (!exactRecordKeys(value, [
        'version', 'matchId', 'a', 'b', 'aRating', 'bRating', 'createdAt', 'seed',
        'aPetId', 'bPetId', 'resolution',
    ])) return false;
    const token = value as unknown as ServerResolvedPetRankedToken;
    if (token.version !== 'pet-ranked-token-v1'
        || !isPetRankedMatchId(token.matchId)
        || typeof token.a !== 'string'
        || typeof token.b !== 'string'
        || token.a !== safeName(token.a)
        || token.b !== safeName(token.b)
        || !token.a
        || !token.b
        || token.a === token.b
        || !Number.isSafeInteger(token.aRating)
        || token.aRating < 0
        || !Number.isSafeInteger(token.bRating)
        || token.bRating < 0
        || !Number.isSafeInteger(token.createdAt)
        || token.createdAt <= 0
        || !Number.isSafeInteger(token.seed)
        || token.seed < 1
        || token.seed > 0x7fffffff
        || typeof token.aPetId !== 'string'
        || typeof token.bPetId !== 'string'
        || !PET_ID.test(token.aPetId)
        || !PET_ID.test(token.bPetId)
        || !exactRecordKeys(token.resolution, [
            'authority', 'engineVersion', 'winner', 'resolvedAt', 'engineDigest', 'reward',
        ])) return false;
    const resolution = token.resolution;
    if (resolution.authority !== 'server-engine-v1'
        || resolution.engineVersion !== PET_RANKED_ENGINE_VERSION
        || (resolution.winner !== 'a' && resolution.winner !== 'b' && resolution.winner !== 'draw')
        || !Number.isSafeInteger(resolution.resolvedAt)
        || resolution.resolvedAt < token.createdAt
        || !/^[a-f0-9]{64}$/.test(resolution.engineDigest)
        || !exactRecordKeys(resolution.reward, ['kind', 'ryo', 'aDelta', 'bDelta'])) return false;
    const delta = resolution.winner === 'a'
        ? rankedDelta(token.aRating, token.bRating)
        : resolution.winner === 'b'
            ? rankedDelta(token.bRating, token.aRating)
            : 0;
    const expectedA = resolution.winner === 'a' ? delta : resolution.winner === 'b' ? -delta : 0;
    return resolution.reward.kind === 'pet-rating-v1'
        && resolution.reward.ryo === 0
        && resolution.reward.aDelta === expectedA
        && resolution.reward.bDelta === -expectedA;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function snapshotJutsu(raw: unknown, rarity: string): PetJutsu {
    const rec = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const kind = JUTSU_KINDS.has(rec.kind as PetJutsu['kind'])
        ? rec.kind as PetJutsu['kind']
        : 'damage';
    return {
        name: String(rec.name ?? 'Strike').slice(0, 40),
        power: clampInt(rec.power, 1, petJutsuPowerCeil(rarity), 80),
        cooldown: clampInt(rec.cooldown, 0, 60, 0),
        currentCooldown: 0,
        kind,
        ...(typeof rec.rounds === 'number' ? { rounds: clampInt(rec.rounds, 1, 20, 1) } : {}),
        ...(rec.signature === true ? { signature: true } : {}),
        ...(rec.aoe === true ? { aoe: true } : {}),
    };
}

/**
 * Freeze one save-owned pet to a bounded, engine-ready snapshot. The general
 * save path already protects these fields; these bounds are defense-in-depth
 * for legacy/corrupt records and keep private QA from sealing impossible stats.
 */
export function snapshotPetForRanked(raw: Record<string, unknown>): Pet | null {
    const id = String(raw.id ?? '');
    if (!PET_ID.test(id)) return null;
    const rawRarity = String(raw.rarity ?? 'standard');
    const rarity = RARITIES.has(rawRarity) ? rawRarity : 'standard';
    const rawElement = String(raw.element ?? 'None');
    const element = ELEMENTS.has(rawElement) ? rawElement : 'None';
    const loadout = raw.loadout && typeof raw.loadout === 'object'
        ? raw.loadout as Record<string, unknown>
        : null;
    const pvp = typeof loadout?.pvp === 'string' ? loadout.pvp.slice(0, 80) : '';
    const consumable = typeof loadout?.consumable === 'string' ? loadout.consumable.slice(0, 80) : '';
    const jutsus = Array.isArray(raw.jutsus)
        ? raw.jutsus.slice(0, 4).map((jutsu) => snapshotJutsu(jutsu, rarity))
        : [];
    return {
        id,
        name: String(raw.name ?? 'Pet').slice(0, 40),
        rarity: rarity as Pet['rarity'],
        level: clampInt(raw.level, 1, 100, 1),
        xp: 0,
        maxLevel: 100,
        hp: clampInt(raw.hp, 1, petStatCeil(rarity, 'hp'), 320),
        attack: clampInt(raw.attack, 1, petStatCeil(rarity, 'attack'), 40),
        defense: clampInt(raw.defense, 0, petStatCeil(rarity, 'defense'), 28),
        speed: clampInt(raw.speed, 1, petStatCeil(rarity, 'speed'), 30),
        element: element as Pet['element'],
        jutsus,
        unlockedForPve: false,
        ...(typeof raw.trait === 'string' ? { trait: raw.trait as Pet['trait'] } : {}),
        ...(pvp || consumable
            ? { loadout: { ...(pvp ? { pvp } : {}), ...(consumable ? { consumable } : {}) } }
            : {}),
    };
}

/**
 * The server picks the first ready pet from the entitlement-projected carried
 * roster (active slot first, then reserve/roster order). Body pet ids are never
 * accepted by the ranked start endpoint.
 */
export function chooseAuthoritativeRankedPet(
    character: Record<string, unknown> | null | undefined,
    now = Date.now(),
): AuthoritativeRankedPetChoice {
    if (!character) return { ok: false, reason: 'missing-character' };
    const entitled = activeCarriedPets<Record<string, unknown>>(character);
    if (!entitled.length) return { ok: false, reason: 'no-entitled-pet' };
    for (const raw of entitled) {
        if (petCombatBusyReason(character, raw, now)) continue;
        const pet = snapshotPetForRanked(raw);
        if (pet) return { ok: true, pet };
    }
    return { ok: false, reason: 'all-entitled-pets-busy' };
}

function rating(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEFAULT_RANKED_RATING;
}

function digestMaterial(pet: Pet): Record<string, unknown> {
    return {
        id: pet.id,
        name: pet.name,
        rarity: pet.rarity,
        level: pet.level,
        hp: pet.hp,
        attack: pet.attack,
        defense: pet.defense,
        speed: pet.speed,
        element: pet.element,
        trait: pet.trait,
        jutsus: pet.jutsus,
        loadout: pet.loadout,
    };
}

/** Resolve a queue-owned pair with the deterministic private server engine. */
export function resolveAuthoritativePetRankedMatch(input: {
    matchId: string;
    a: string;
    b: string;
    aCharacter: Record<string, unknown>;
    bCharacter: Record<string, unknown>;
    aPet: Pet;
    bPet: Pet;
    seed: number;
    now?: number;
}): ServerResolvedPetRankedToken {
    const a = safeName(input.a);
    const b = safeName(input.b);
    if (!isPetRankedMatchId(input.matchId) || !a || !b || a === b) {
        throw new Error('invalid-pet-ranked-pair');
    }
    if (!Number.isSafeInteger(input.seed) || input.seed < 1 || input.seed > 0x7fffffff) {
        throw new Error('invalid-pet-ranked-seed');
    }
    const createdAt = Math.max(1, Math.floor(Number(input.now ?? Date.now())));
    const aRating = rating(input.aCharacter.petRankedRating);
    const bRating = rating(input.bCharacter.petRankedRating);
    // Items and accuracy are pinned ON for both sides. No per-device feature
    // flag can change the server result.
    const simulated = runPetDuel(input.aPet, input.bPet, input.seed, 1, 1, false, true, true, null, false);
    const winner = simulated.result === 'win' ? 'a' : simulated.result === 'loss' ? 'b' : 'draw';
    const delta = winner === 'a'
        ? rankedDelta(aRating, bRating)
        : winner === 'b'
            ? rankedDelta(bRating, aRating)
            : 0;
    const reward: PetRankedRatingReward = {
        kind: 'pet-rating-v1',
        ryo: 0,
        aDelta: winner === 'a' ? delta : winner === 'b' ? -delta : 0,
        bDelta: winner === 'b' ? delta : winner === 'a' ? -delta : 0,
    };
    const engineDigest = createHash('sha256').update(JSON.stringify({
        engineVersion: PET_RANKED_ENGINE_VERSION,
        matchId: input.matchId,
        seed: input.seed,
        a: digestMaterial(input.aPet),
        b: digestMaterial(input.bPet),
        result: simulated.result,
        ticks: simulated.ticks,
        reward,
    })).digest('hex');

    return {
        version: 'pet-ranked-token-v1',
        matchId: input.matchId,
        a,
        b,
        aRating,
        bRating,
        createdAt,
        seed: input.seed,
        aPetId: input.aPet.id,
        bPetId: input.bPet.id,
        resolution: {
            authority: 'server-engine-v1',
            engineVersion: PET_RANKED_ENGINE_VERSION,
            winner,
            resolvedAt: createdAt,
            engineDigest,
            reward,
        },
    };
}

/**
 * Validate the reciprocal queue records. One client cannot manufacture a
 * pairing by writing an opponent name into ranked-start's body.
 */
export function validateReciprocalPetRankedQueueMatch(
    playerName: string,
    mine: PetRankedQueueMatch | null,
    theirs: PetRankedQueueMatch | null,
    now = Date.now(),
): { ok: true; matchId: string; opponent: string } | { ok: false; reason: string } {
    const me = safeName(playerName);
    const opponent = safeName(mine?.opponent ?? '');
    if (!me || !mine || !isPetRankedMatchId(mine.matchId) || !opponent || opponent === me) {
        return { ok: false, reason: 'missing-server-pairing' };
    }
    if (!Number.isFinite(mine.createdAt)
        || mine.createdAt > now + 5_000
        || now - mine.createdAt > PET_RANKED_QUEUE_MATCH_TTL_SECONDS * 1_000) {
        return { ok: false, reason: 'expired-server-pairing' };
    }
    if (!theirs
        || theirs.matchId !== mine.matchId
        || safeName(theirs.opponent) !== me
        || theirs.initiator === mine.initiator
        || theirs.createdAt !== mine.createdAt) {
        return { ok: false, reason: 'nonreciprocal-server-pairing' };
    }
    return { ok: true, matchId: mine.matchId, opponent };
}

/**
 * Claim both participants' shared pet-battle leases. Each NX write is atomic.
 * Callers MUST durably reserve the pair preparation before entering here. Once
 * the first lease lands it is never rolled back merely because the second write
 * failed: that would reopen one fighter while a recoverable ranked preparation
 * still owns the pair. Any participant/rollover helper retries the missing row.
 * Production ranked claims are deliberately
 * non-expiring from their first NX write: a crash must never open a window where
 * training, Sanctuary, or another pet battle can claim a fighter while ranked
 * settlement is unresolved. Completion later converts owned rows to a bounded
 * acknowledgement TTL. Tests may pass a TTL explicitly when exercising expiry
 * mechanics in isolation.
 */
export async function claimPetRankedActivePair(
    store: Pick<KvLike, 'get' | 'set' | 'delIfEqual'>,
    players: readonly [string, string],
    matchToken: string,
    ttlSeconds?: number,
): Promise<PetRankedActiveClaim> {
    const names = [...new Set(players.map(safeName))].sort();
    if (names.length !== 2 || !isPetRankedMatchId(matchToken)) throw new Error('invalid-pet-ranked-active-pair');
    const freshKeys: string[] = [];
    try {
        for (const name of names) {
            const key = petRankedActiveKey(name);
            const before = await store.get<string>(key);
            if (before === matchToken) continue;
            if (before) {
                return { ok: false, conflictPlayer: name };
            }
            try {
                const placed = await store.set(key, matchToken, {
                    nx: true,
                    ...(Number.isFinite(ttlSeconds) && Number(ttlSeconds) > 0
                        ? { ex: Math.max(1, Math.floor(Number(ttlSeconds))) }
                        : {}),
                });
                if (placed === 'OK') {
                    freshKeys.push(key);
                    continue;
                }
            } catch (error) {
                // A lost acknowledgement is success if the exact token landed.
                if (await store.get<string>(key).catch(() => null) === matchToken) {
                    freshKeys.push(key);
                    continue;
                }
                throw error;
            }
            if (await store.get<string>(key) === matchToken) continue;
            return { ok: false, conflictPlayer: name };
        }
        return { ok: true, freshKeys };
    } catch (error) {
        throw error;
    }
}

async function releasePetRankedStartingKeys(
    store: Pick<KvLike, 'get' | 'delIfEqual'>,
    keys: readonly string[],
    token: string,
): Promise<void> {
    await Promise.all([...new Set(keys)].map(async (key) => {
        try {
            await store.delIfEqual(key, token);
        } catch (error) {
            const recovered = await store.get<string>(key);
            if (recovered === token) throw error;
            return;
        }
        if (await store.get<string>(key) === token) {
            throw new Error('pet-ranked-starting-cleanup-unconfirmed');
        }
    }));
}

/**
 * Reversible, non-economic preflight. Both shared pet-battle keys must carry
 * this short starting intent before saves are snapshotted or an outcome is
 * admitted. A second-key conflict exact-releases the first, so a 409 response
 * cannot leave a preparation or ranked lease behind.
 */
export async function claimPetRankedStartingPair(
    store: Pick<KvLike, 'get' | 'set' | 'delIfEqual'>,
    players: readonly [string, string],
    matchId: string,
    ttlSeconds = 120,
): Promise<PetRankedActiveClaim> {
    const names = [...new Set(players.map(safeName))].sort();
    if (names.length !== 2 || !isPetRankedMatchId(matchId)) throw new Error('invalid-pet-ranked-starting-pair');
    const token = petRankedStartingLeaseToken(matchId);
    const freshKeys: string[] = [];
    const ownedKeys: string[] = [];
    for (const name of names) {
        const key = petRankedActiveKey(name);
        const before = await store.get<string>(key);
        if (before === token) {
            ownedKeys.push(key);
            continue;
        }
        if (before) {
            await releasePetRankedStartingKeys(store, ownedKeys, token);
            return { ok: false, conflictPlayer: name };
        }
        try {
            if (await store.set(key, token, { nx: true, ex: Math.max(30, Math.floor(ttlSeconds)) }) === 'OK') {
                freshKeys.push(key);
                ownedKeys.push(key);
                continue;
            }
        } catch (error) {
            if (await store.get<string>(key).catch(() => null) === token) {
                freshKeys.push(key);
                ownedKeys.push(key);
                continue;
            }
            await releasePetRankedStartingKeys(store, ownedKeys, token);
            throw error;
        }
        if (await store.get<string>(key) === token) {
            ownedKeys.push(key);
            continue;
        }
        {
            await releasePetRankedStartingKeys(store, ownedKeys, token);
            return { ok: false, conflictPlayer: name };
        }
    }
    return { ok: true, freshKeys };
}

/** Upgrade owned starting intents, or recover an expired one, after admission. */
export async function commitPetRankedStartingPair(
    store: Pick<KvLike, 'get' | 'set' | 'compareSet'>,
    players: readonly [string, string],
    matchId: string,
): Promise<PetRankedActiveClaim> {
    const names = [...new Set(players.map(safeName))].sort();
    if (names.length !== 2 || !isPetRankedMatchId(matchId)) throw new Error('invalid-pet-ranked-starting-pair');
    const starting = petRankedStartingLeaseToken(matchId);
    const freshKeys: string[] = [];
    for (const name of names) {
        const key = petRankedActiveKey(name);
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const current = await store.get<string>(key);
            if (current === matchId) break;
            if (current && current !== starting) return { ok: false, conflictPlayer: name };
            try {
                if (current === starting) {
                    if (await store.compareSet(key, starting, matchId)) {
                        freshKeys.push(key);
                        break;
                    }
                } else if (await store.set(key, matchId, { nx: true }) === 'OK') {
                    freshKeys.push(key);
                    break;
                }
            } catch (error) {
                if (await store.get<string>(key).catch(() => null) === matchId) {
                    freshKeys.push(key);
                    break;
                }
                throw error;
            }
            if (attempt === 7) return { ok: false, conflictPlayer: name };
        }
    }
    return { ok: true, freshKeys };
}

export async function releasePetRankedStartingPair(
    store: Pick<KvLike, 'get' | 'delIfEqual'>,
    players: readonly [string, string],
    matchId: string,
): Promise<void> {
    const token = petRankedStartingLeaseToken(matchId);
    await releasePetRankedStartingKeys(
        store,
        players.map((name) => petRankedActiveKey(name)),
        token,
    );
}

export async function releasePetRankedActivePair(
    store: Pick<KvLike, 'delIfEqual'>,
    players: readonly [string, string],
    matchToken: string,
): Promise<void> {
    await Promise.all(players.map((name) =>
        store.delIfEqual(petRankedActiveKey(name), matchToken).catch(() => false),
    ));
}
