/**
 * Cinderhold level scaling (2026-11-08).
 *
 * Once a day the NPC village's base level follows the top 30 ELIGIBLE players:
 * real, recently active, unbanned accounts. Guests, admin/system keys, banned
 * players, anyone idle for 7 days and the NPCs themselves never count. The mean
 * drops the top three levels (one inflated account cannot drag it) and the base
 * moves at most three levels a day, so the village grows alongside players
 * instead of snapping to them (the rubber-band feel players dislike).
 *
 * Each NPC fights at base + its rank offset (NPC_RANK_LEVEL_OFFSET), clamped to
 * 1..100. Nothing here pays or costs anything.
 *
 * Pets follow the same idea (owner ruling 2026-11-09): the top
 * NPC_PET_SCALING_SAMPLE of those same eligible players each put their four
 * highest pet levels into a pool, and the median of the pool is the village's
 * pet base. It moves at most NPC_SCALING_MAX_DAILY_STEP a day, and each NPC's
 * pets stand at that base plus the NPC's rank offset, so as players' companions
 * level up, Cinderhold's do too.
 */
import { kv } from './_storage.js';
import { MAX_LEVEL } from './_xp-engine.js';
import { readPublicPlayerIndex } from './player/_public-index-store.js';
import { isPublicPlayerIndexKey } from './player/_public-index.js';
import { authKey, isCredentialLessGuest, type AuthRecord } from './player-auth.js';
import { getActiveBan } from './admin/moderation.js';
import { isNpcAccount, NPC_RANK_LEVEL_OFFSET, type NpcRank } from '../shared/npc-village-roster.js';

export const NPC_SCALING_SAMPLE = 30;
export const NPC_SCALING_TRIM_TOP = 3;
export const NPC_SCALING_MAX_DAILY_STEP = 3;
export const NPC_SCALING_ACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
/** Before any player qualifies (a fresh server) the village sits here. */
export const NPC_SCALING_FLOOR = 10;
export const NPC_VILLAGE_STATE_KEY = 'npc-village:state';

export type ScalingCandidate = { key: string; level: number; lastSeen: number };
export type NpcVillageScaling = {
    baseLevel: number; target: number; sample: number; computedAt: number;
    /** Pet base. Absent on rows written before pet scaling: the first pass then
     *  takes the target outright (as the level base does on a fresh server) rather
     *  than walking every NPC pet up from level 1 three levels a day. */
    petBaseLevel?: number; petTarget?: number; petSample?: number;
};
export const NPC_PET_SCALING_SAMPLE = 15;
export const NPC_PET_LEVELS_PER_PLAYER = 4;
/** Before any player has a pet past level 1 (a fresh server) NPC pets sit here. */
export const NPC_PET_SCALING_FLOOR = 1;

const clampLevel = (n: number) => Math.max(1, Math.min(MAX_LEVEL, Math.round(n)));

/** Registry rows that may be considered at all, highest level first. */
export function scalingCandidates(entries: Iterable<[string, { level?: number; lastSeen?: number }]>, now: number): ScalingCandidate[] {
    const out: ScalingCandidate[] = [];
    for (const [key, entry] of entries) {
        const level = Number(entry?.level), lastSeen = Number(entry?.lastSeen ?? 0);
        if (!isPublicPlayerIndexKey(key) || isNpcAccount(key)) continue;
        if (!Number.isFinite(level) || level < 1) continue;
        if (!(now - lastSeen <= NPC_SCALING_ACTIVE_MS)) continue;
        out.push({ key, level: clampLevel(level), lastSeen });
    }
    return out.sort((a, b) => b.level - a.level || b.lastSeen - a.lastSeen || a.key.localeCompare(b.key));
}

/** Mean of the sample after dropping its top NPC_SCALING_TRIM_TOP levels. */
export function trimmedMeanLevel(levels: readonly number[]): number | null {
    if (!levels.length) return null;
    const sorted = [...levels].sort((a, b) => b - a);
    const kept = sorted.length > NPC_SCALING_TRIM_TOP * 2 ? sorted.slice(NPC_SCALING_TRIM_TOP) : sorted;
    return clampLevel(kept.reduce((sum, n) => sum + n, 0) / kept.length);
}

/** Moves toward the target by at most NPC_SCALING_MAX_DAILY_STEP. */
export function nextBaseLevel(previous: number | null | undefined, target: number | null): number {
    const goal = target ?? NPC_SCALING_FLOOR;
    if (previous === null || previous === undefined || !Number.isFinite(previous)) return clampLevel(goal);
    const step = Math.max(-NPC_SCALING_MAX_DAILY_STEP, Math.min(NPC_SCALING_MAX_DAILY_STEP, goal - previous));
    return clampLevel(previous + step);
}

/**
 * The lowest level any Cinderhold shinobi fights at. Below 10 a shinobi is under
 * newcomer protection and cannot be attacked, and these NPCs are never
 * newcomers: without the floor a low-level server (a base under 20) would make
 * its genin untouchable. Above it the rank offsets apply unchanged.
 */
export const NPC_MIN_LEVEL = 10;
/**
 * Cinderhold's war ranks (Commanders, Elites, Jonin: its ANBU) never fight
 * below the level a player needs to take part in a village war (15), or its
 * campaign defenders, shrine holders and field orders could not exist at all
 * on a low-level server (Push 4b). The rest of the village keeps the 10 floor.
 */
export const NPC_WAR_RANK_MIN_LEVEL = 15;
const NPC_WAR_RANKS: readonly NpcRank[] = ['commander', 'elite', 'jonin'];

/** The level an NPC of `rank` fights at for this base. */
export function npcLevelFor(rank: NpcRank, baseLevel: number): number {
    return Math.max(NPC_WAR_RANKS.includes(rank) ? NPC_WAR_RANK_MIN_LEVEL : NPC_MIN_LEVEL, clampLevel(baseLevel + NPC_RANK_LEVEL_OFFSET[rank]));
}

/** Median of each sampled player's four highest pet levels, pooled. */
export function medianTopPetLevel(petLevelsByPlayer: readonly (readonly number[])[]): number | null {
    const pool = petLevelsByPlayer.flatMap((levels) => [...levels].filter((n) => Number.isFinite(n) && n >= 1)
        .sort((a, b) => b - a).slice(0, NPC_PET_LEVELS_PER_PLAYER));
    if (!pool.length) return null;
    const sorted = pool.sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return clampLevel(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Moves the pet base toward its target by at most NPC_SCALING_MAX_DAILY_STEP. */
export function nextPetBaseLevel(previous: number | null | undefined, target: number | null): number {
    const goal = target ?? NPC_PET_SCALING_FLOOR;
    if (previous === null || previous === undefined || !Number.isFinite(previous)) return clampLevel(goal);
    const step = Math.max(-NPC_SCALING_MAX_DAILY_STEP, Math.min(NPC_SCALING_MAX_DAILY_STEP, goal - previous));
    return clampLevel(previous + step);
}

/** The level an NPC of `rank` fields its pets at for this pet base. */
export function npcPetLevelFor(rank: NpcRank, petBaseLevel: number | undefined): number {
    return clampLevel((petBaseLevel ?? NPC_PET_SCALING_FLOOR) + NPC_RANK_LEVEL_OFFSET[rank]);
}

/**
 * The pet sample: walking the eligible players highest level first, the first
 * NPC_PET_SCALING_SAMPLE who own a pet. A top player with no pets yet gives
 * their place to the next one, so the sample is 15 pet owners whenever 15 exist.
 */
export function petSampleFrom(saves: readonly unknown[]): number[][] {
    const out: number[][] = [];
    for (const save of saves) {
        if (out.length >= NPC_PET_SCALING_SAMPLE) break;
        const levels = petLevelsOfSave(save);
        if (levels.length) out.push(levels);
    }
    return out;
}

/** A player's pet levels as their save stores them. */
export function petLevelsOfSave(save: unknown): number[] {
    const pets = (save as { character?: { pets?: unknown } } | null)?.character?.pets;
    return Array.isArray(pets) ? pets.map((pet) => Math.floor(Number((pet as { level?: unknown })?.level))).filter((n) => Number.isFinite(n) && n >= 1) : [];
}

type PetScaling = Pick<NpcVillageScaling, 'petBaseLevel' | 'petTarget' | 'petSample'>;

/** The pet half of the daily pass. A failed read is no evidence: the stored pet base stays exactly as it was. */
async function nextPetScaling(eligible: readonly string[], previous: NpcVillageScaling | null): Promise<PetScaling> {
    let saves: unknown[];
    try {
        saves = eligible.length ? await kv.mget<unknown[]>(...eligible.map((key) => `save:${key}`)) : [];
    } catch {
        if (previous?.petBaseLevel !== undefined) return { petBaseLevel: previous.petBaseLevel, petTarget: previous.petTarget, petSample: previous.petSample };
        return { petBaseLevel: NPC_PET_SCALING_FLOOR, petTarget: NPC_PET_SCALING_FLOOR, petSample: 0 };
    }
    const sample = petSampleFrom(saves);
    const petTarget = medianTopPetLevel(sample);
    return { petBaseLevel: nextPetBaseLevel(previous?.petBaseLevel, petTarget), petTarget: petTarget ?? NPC_PET_SCALING_FLOOR, petSample: sample.length };
}

/** The eligible players, highest level first (the level sample's own walk). */
async function eligiblePlayers(now: number): Promise<{ keys: string[]; levels: number[] }> {
    const { entries } = await readPublicPlayerIndex({ logContext: 'npc-village-scaling' });
    const keys: string[] = [], levels: number[] = [];
    for (const candidate of scalingCandidates(entries, now)) {
        if (levels.length >= NPC_SCALING_SAMPLE) break;
        const auth = await kv.get<AuthRecord>(authKey(candidate.key)).catch(() => null);
        if (!auth || isCredentialLessGuest(auth)) continue;
        if (await getActiveBan(candidate.key).catch(() => null)) continue;
        levels.push(candidate.level);
        keys.push(candidate.key);
    }
    return { keys, levels };
}

/**
 * Fills in the pet base on a row written before pet scaling, leaving the level
 * base untouched (an admin rebuild or a reset must not move it a second step in
 * one day). Does nothing when the row already has a pet base.
 */
export async function ensureNpcPetScaling(now = Date.now()): Promise<NpcVillageScaling> {
    const previous = await readNpcVillageScaling();
    if (!previous) return refreshNpcVillageScaling(now);
    if (previous.petBaseLevel !== undefined) return previous;
    const next: NpcVillageScaling = { ...previous, ...await nextPetScaling((await eligiblePlayers(now)).keys, previous) };
    await kv.set(NPC_VILLAGE_STATE_KEY, next);
    return next;
}

export async function readNpcVillageScaling(): Promise<NpcVillageScaling | null> {
    const row = await kv.get<NpcVillageScaling>(NPC_VILLAGE_STATE_KEY);
    return row && Number.isFinite(row.baseLevel) ? row : null;
}

/**
 * Daily job. Walks the registry top-down, confirming guests and bans only for
 * the rows it is about to use (at most a few dozen reads), and stores the new
 * base. Returns what it wrote.
 */
export async function refreshNpcVillageScaling(now = Date.now()): Promise<NpcVillageScaling> {
    const { keys: eligible, levels } = await eligiblePlayers(now);
    const previous = await readNpcVillageScaling();
    const target = trimmedMeanLevel(levels);
    const next: NpcVillageScaling = {
        baseLevel: nextBaseLevel(previous?.baseLevel, target), target: target ?? NPC_SCALING_FLOOR, sample: levels.length, computedAt: now,
        ...await nextPetScaling(eligible, previous),
    };
    await kv.set(NPC_VILLAGE_STATE_KEY, next);
    return next;
}
