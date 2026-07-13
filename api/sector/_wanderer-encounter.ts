/*
 * Shared server-side guard for natural sector wanderers.
 *
 * The client renders natural wanderers with ids shaped like:
 *   w-<homeSector>-<sixHourBucket>-<rosterIndex>
 *
 * Legacy Sage / Legacy Emissary NPCs use synthetic ids and intentionally do not
 * enter this cooldown/relocation path.
 */

import { setSafeRecordValue } from '../_utils.js';

export const WANDERER_ENCOUNTER_COOLDOWN_MS = 3 * 60 * 60 * 1000;
export const WANDERER_ENCOUNTER_COOLDOWN_SECONDS = Math.ceil(WANDERER_ENCOUNTER_COOLDOWN_MS / 1000);
export const WANDERER_SECTOR_COUNT = 60;

export type NaturalWandererId = { sector: number; dayBucket: number; index: number };

export function parseNaturalWandererId(id: string): NaturalWandererId | null {
    const m = /^w-(\d+)-(\d+)-(\d+)$/.exec(String(id ?? ''));
    if (!m) return null;
    return { sector: Number(m[1]), dayBucket: Number(m[2]), index: Number(m[3]) };
}

export function wandererDayBucketFromMs(nowMs: number): number {
    return Math.floor(nowMs / (6 * 60 * 60 * 1000));
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
    let h = 2166136261 >>> 0;
    const key = `${wandererId}#${from}`;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const span = Math.max(1, maxSector - 1);
    let dest = 1 + ((h >>> 0) % span);
    if (dest >= from) dest += 1;
    return Math.max(1, Math.min(maxSector, dest));
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
): Promise<WandererCooldownClaim> {
    if (!parseNaturalWandererId(wandererId)) return { ok: false, reason: 'invalid-wanderer' };

    const key = wandererUseCooldownKey(playerName, wandererId);
    const existing = await kv.get<{ cooldownUntil?: unknown } | number>(key);
    const existingUntil = typeof existing === 'number' ? existing : num(existing?.cooldownUntil);
    if (existingUntil > nowMs) {
        return { ok: false, reason: 'cooldown', cooldownUntil: existingUntil };
    }

    const cooldownUntil = nowMs + WANDERER_ENCOUNTER_COOLDOWN_MS;
    const claimed = await kv.set(key, { cooldownUntil }, {
        ex: WANDERER_ENCOUNTER_COOLDOWN_SECONDS,
        nx: true,
    });
    if (claimed === 'OK') return { ok: true, cooldownUntil };

    const raced = await kv.get<{ cooldownUntil?: unknown } | number>(key);
    const racedUntil = typeof raced === 'number' ? raced : num(raced?.cooldownUntil);
    return { ok: false, reason: 'cooldown', cooldownUntil: racedUntil > nowMs ? racedUntil : undefined };
}
