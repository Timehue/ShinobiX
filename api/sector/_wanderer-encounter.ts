/*
 * Shared server-side guard for natural sector wanderers.
 *
 * The client renders natural wanderers with ids shaped like:
 *   w-<homeSector>-<sixHourBucket>-<rosterIndex>
 *
 * The roster itself is NOT trusted from the client: shared/wanderer-roster.ts
 * is the one roll both sides run, and `resolveNaturalWanderer` re-derives the
 * NPC an id names for the server's current window — a forged id, a stale or
 * future bucket, or an index past the rolled count resolves to null.
 *
 * Every reward handler that takes a wanderer id enters through
 * `naturalWandererClaimOk` (gift, quest, service) or `resolveNaturalWanderer`
 * (the Solo-PvE / pet-duel authority), so a claimed archetype/verb/level/name is
 * checked against the roll rather than merely shape-checked.
 *
 * Legacy Sage / Legacy Emissary NPCs use synthetic ids and intentionally do not
 * enter this cooldown/relocation path.
 */

import { setSafeRecordValue } from '../_utils.js';
import {
    parseWandererId,
    resolveWandererById,
    rollWanderers,
    wandererDayBucketFromMs,
    wandererRelocationSector as sharedRelocationSector,
    WANDERER_SECTOR_COUNT,
    type Wanderer,
} from '../../shared/wanderer-roster.js';

export { rollWanderers, wandererDayBucketFromMs, WANDERER_SECTOR_COUNT };
export type { Wanderer };

export const WANDERER_ENCOUNTER_COOLDOWN_MS = 3 * 60 * 60 * 1000;
export const WANDERER_ENCOUNTER_COOLDOWN_SECONDS = Math.ceil(WANDERER_ENCOUNTER_COOLDOWN_MS / 1000);

export type NaturalWandererId = { sector: number; dayBucket: number; index: number };

export function parseNaturalWandererId(id: string): NaturalWandererId | null {
    return parseWandererId(id);
}

/**
 * The natural wanderer `id` names in the server's CURRENT window, re-derived
 * from the shared roll — or null when the id is forged/stale/out of range.
 * Relocation is honoured: a wanderer the player already dealt with is found in
 * its `wandererMoves` destination sector, not its home sector. When
 * `requestedSector` is given, the wanderer must actually be standing there.
 */
export function resolveNaturalWanderer(
    id: string,
    nowMs: number,
    character?: Record<string, unknown> | null,
    requestedSector?: number,
): Wanderer | null {
    const w = resolveWandererById(id, nowMs);
    if (!w) return null;
    const parsed = parseWandererId(id)!;
    const movesRaw = character?.wandererMoves;
    const moves = movesRaw && typeof movesRaw === 'object' && !Array.isArray(movesRaw)
        ? movesRaw as Record<string, unknown>
        : {};
    const moved = Math.floor(Number(moves[id]));
    const visibleSector = Number.isFinite(moved) && moved >= 1 && moved <= WANDERER_SECTOR_COUNT ? moved : parsed.sector;
    if (requestedSector !== undefined && visibleSector !== requestedSector) return null;
    return w;
}

/** True when the client's claimed archetype/verb/level/name for `id` match what
 *  the shared roll says the world contains right now. Any mismatch = forged. */
export function naturalWandererMatches(
    id: string,
    nowMs: number,
    claim: { archetype?: unknown; verb?: unknown; level?: unknown; name?: unknown },
): boolean {
    const w = resolveWandererById(id, nowMs);
    if (!w) return false;
    if (claim.archetype !== undefined && claim.archetype !== w.archetype) return false;
    if (claim.verb !== undefined && claim.verb !== w.verb) return false;
    if (claim.level !== undefined && Number(claim.level) !== w.level) return false;
    if (claim.name !== undefined && claim.name !== w.name) return false;
    return true;
}

/** The optional identity fields a client may echo back alongside a wanderer id. */
export type WandererClaimBody = {
    wandererArchetype?: unknown;
    wandererVerb?: unknown;
    wandererLevel?: unknown;
    wandererName?: unknown;
};

/**
 * The reward handlers' entry guard: `id` must be a natural wanderer the shared
 * roll actually puts on the road in the server's CURRENT window, AND every
 * identity field the client chose to echo back must agree with that roll.
 *
 * Checking the id's SHAPE alone is not enough — it admits a stale/empty roster
 * slot, and it lets a forged archetype/verb/level/name ride along into a payout
 * path that then reads those fields back (wanderer-service seals the claimed
 * name into the favor record). Fields the client omits are not invented here;
 * `naturalWandererMatches` skips them.
 */
export function naturalWandererClaimOk(id: string, nowMs: number, body: WandererClaimBody): boolean {
    if (!parseNaturalWandererId(id)) return false;
    return naturalWandererMatches(id, nowMs, {
        ...(body.wandererArchetype !== undefined ? { archetype: body.wandererArchetype } : {}),
        ...(body.wandererVerb !== undefined ? { verb: body.wandererVerb } : {}),
        ...(body.wandererLevel !== undefined ? { level: body.wandererLevel } : {}),
        ...(body.wandererName !== undefined ? { name: body.wandererName } : {}),
    });
}

export function wandererUseCooldownKey(playerName: string, wandererId: string): string {
    return `wanderer-use:${playerName}:${wandererId}`;
}

function num(v: unknown): number {
    return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function record(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

export function currentWandererCooldownUntil(
    character: Record<string, unknown>,
    wandererId: string,
    nowMs: number,
): number | null {
    const cooldowns = record(character.wandererCooldowns);
    const until = num(cooldowns[wandererId]);
    return until > nowMs ? until : null;
}

export function pruneWandererCooldownsForSave(
    cooldowns: unknown,
    nowMs: number,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, rawUntil] of Object.entries(record(cooldowns))) {
        const until = num(rawUntil);
        if (until > nowMs) setSafeRecordValue(out, id, until);
    }
    return out;
}

export function pruneWandererMovesForSave(
    moves: unknown,
    currentDayBucket: number,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, rawSector] of Object.entries(record(moves))) {
        const parsed = parseNaturalWandererId(id);
        const sector = Math.floor(num(rawSector));
        if (!parsed || parsed.dayBucket !== currentDayBucket) continue;
        if (sector >= 1 && sector <= WANDERER_SECTOR_COUNT) setSafeRecordValue(out, id, sector);
    }
    return out;
}

export function wandererRelocationSector(
    wandererId: string,
    fromSector: number,
    maxSector: number = WANDERER_SECTOR_COUNT,
): number {
    const from = Math.max(1, Math.min(maxSector, Math.floor(num(fromSector)) || 1));
    return sharedRelocationSector(wandererId, from, maxSector);
}

export function withWandererUseState(
    character: Record<string, unknown>,
    wandererId: string,
    nowMs: number,
    fromSector: number,
): { character: Record<string, unknown>; cooldownUntil: number; moveToSector: number } {
    const parsed = parseNaturalWandererId(wandererId);
    if (!parsed) {
        throw new Error('withWandererUseState requires a natural wanderer id.');
    }

    const cooldownUntil = nowMs + WANDERER_ENCOUNTER_COOLDOWN_MS;
    const bucket = wandererDayBucketFromMs(nowMs);
    const cooldowns = pruneWandererCooldownsForSave(character.wandererCooldowns, nowMs);
    cooldowns[wandererId] = cooldownUntil;

    const moves = pruneWandererMovesForSave(character.wandererMoves, bucket);
    const sourceSector = Math.max(1, Math.floor(num(fromSector)) || parsed.sector);
    const moveToSector = wandererRelocationSector(wandererId, sourceSector);
    moves[wandererId] = moveToSector;

    return {
        character: { ...character, wandererCooldowns: cooldowns, wandererMoves: moves },
        cooldownUntil,
        moveToSector,
    };
}

type CooldownKv = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }): Promise<'OK' | null>;
};

export type WandererCooldownClaim =
    | { ok: true; cooldownUntil: number }
    | { ok: false; reason: 'invalid-wanderer' | 'cooldown'; cooldownUntil?: number };

export async function claimWandererUseCooldown(
    kv: CooldownKv,
    playerName: string,
    wandererId: string,
    nowMs: number,
    proofId?: string,
    claimAtMs: number = nowMs,
): Promise<WandererCooldownClaim> {
    if (!parseNaturalWandererId(wandererId)) return { ok: false, reason: 'invalid-wanderer' };

    const key = wandererUseCooldownKey(playerName, wandererId);
    const existing = await kv.get<{ cooldownUntil?: unknown; proofId?: unknown } | number>(key);
    const existingUntil = typeof existing === 'number' ? existing : num(existing?.cooldownUntil);
    if (existingUntil > nowMs) {
        if (proofId && typeof existing === 'object' && existing?.proofId === proofId) {
            return { ok: true, cooldownUntil: existingUntil };
        }
        return { ok: false, reason: 'cooldown', cooldownUntil: existingUntil };
    }

    const cooldownUntil = claimAtMs + WANDERER_ENCOUNTER_COOLDOWN_MS;
    if (cooldownUntil <= nowMs) return { ok: false, reason: 'cooldown', cooldownUntil };
    const ttlSeconds = Math.max(1, Math.ceil((cooldownUntil - nowMs) / 1000));
    const claimed = await kv.set(key, { cooldownUntil, ...(proofId ? { proofId } : {}) }, {
        ex: ttlSeconds,
        nx: true,
    });
    if (claimed === 'OK') return { ok: true, cooldownUntil };

    const raced = await kv.get<{ cooldownUntil?: unknown; proofId?: unknown } | number>(key);
    const racedUntil = typeof raced === 'number' ? raced : num(raced?.cooldownUntil);
    if (proofId && typeof raced === 'object' && raced?.proofId === proofId && racedUntil > nowMs) {
        return { ok: true, cooldownUntil: racedUntil };
    }
    return { ok: false, reason: 'cooldown', cooldownUntil: racedUntil > nowMs ? racedUntil : undefined };
}
