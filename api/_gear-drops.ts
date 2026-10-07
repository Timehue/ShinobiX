/*
 * Gear step drops (shared/gear-steps.ts) and the tier unlock that gates them.
 *
 * A drop is one built in step item added to the winner's inventory. Which steps
 * can drop depends on character.gearTierUnlocks, which only a shop purchase or a
 * craft raises (withGearTierUnlock). The save sanitizer mirrors the field, so a
 * client can neither raise nor forge it. effectiveGearTierUnlocks also counts gear
 * already held, so players who bought a higher tier before this existed are not
 * stuck; that part is derived on the fly and never stored.
 *
 * A drop is an already earned settlement, so it never refuses when the bag is
 * full (see api/_inventory-capacity.ts).
 */
import { createHmac, randomInt } from 'node:crypto';
import { ITEM_CATALOG } from './pvp/_item-catalog.js';
import { gearTierOf, isStepItemId, MAX_STEP_TIER, type GearKind } from '../shared/gear-steps.js';

/**
 * A number in [0, 1) fixed by an event key (a run id, a dungeon token, a week and a
 * name), so every retry of the same event gets the same answer. It is salted with a
 * server secret: the ids are visible to the client and this code is public, so an
 * unsalted hash would let a player work out which runs will drop and only play those.
 * Without SESSION_SECRET (local runs and tests) it falls back to a fixed salt.
 */
export function gearRoll(eventKey: string): number {
    const salt = process.env.SESSION_SECRET || 'gear-drop-unsalted';
    return createHmac('sha256', salt).update(`gear:${eventKey}`).digest().readUInt32BE(0) / 0x1_0000_0000;
}

export type GearTierUnlocks = { weapon: number; armor: number };

/** Drop chances in basis points (10,000 = 100 percent). */
export const GEAR_DROP_CHANCE_BP = {
    ancientChest: 500,
    boss: 500,
    normalFight: 50,
    clanCache: 2000,
} as const;

const MAX_TIER = 3;

function tierValue(raw: unknown): number {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) ? Math.max(0, Math.min(MAX_TIER, n)) : 0;
}

export function readGearTierUnlocks(raw: unknown): GearTierUnlocks {
    const src = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return { weapon: tierValue(src.weapon), armor: tierValue(src.armor) };
}

type TieredItem = { slot: string; rarity: string; weaponEp?: number; armorQuality?: string };

/** Raise the stored unlock when `item` belongs to a higher weapon or armor tier. Never lowers it. */
export function withGearTierUnlock<T extends Record<string, unknown>>(character: T, item: TieredItem): T {
    const tiered = gearTierOf(item);
    if (!tiered) return character;
    const current = readGearTierUnlocks(character.gearTierUnlocks);
    if (tiered.tier <= current[tiered.kind]) return character;
    return { ...character, gearTierUnlocks: { ...current, [tiered.kind]: tiered.tier } };
}

/**
 * The stored unlock, raised to the highest tier of gear the player already holds.
 * A player who bought or crafted a higher tier before this feature has nothing
 * stored, and must not be held at the lowest tier until they buy or craft again.
 * Step drops themselves never count, or one drop would unlock the next.
 */
export function effectiveGearTierUnlocks(
    character: { gearTierUnlocks?: unknown; inventory?: unknown; equipment?: unknown },
): GearTierUnlocks {
    const out = readGearTierUnlocks(character.gearTierUnlocks);
    for (const id of ownedIds(character)) {
        if (isStepItemId(id) || !ITEM_CATALOG[id]) continue;
        const tiered = gearTierOf(ITEM_CATALOG[id]);
        if (tiered && tiered.tier > out[tiered.kind]) out[tiered.kind] = tiered.tier;
    }
    return out;
}

type Pool = Record<GearKind, string[][]>;
let poolCache: Pool | null = null;

/** Step item ids grouped by kind, then by tier. Built once from the generated catalog. */
function stepPool(): Pool {
    if (poolCache) return poolCache;
    const pool: Pool = {
        weapon: Array.from({ length: MAX_STEP_TIER + 1 }, () => []),
        armor: Array.from({ length: MAX_STEP_TIER + 1 }, () => []),
    };
    for (const id of Object.keys(ITEM_CATALOG).sort()) {
        if (!isStepItemId(id)) continue;
        const tiered = gearTierOf(ITEM_CATALOG[id]);
        if (tiered && tiered.tier <= MAX_STEP_TIER) pool[tiered.kind][tiered.tier].push(id);
    }
    poolCache = pool;
    return pool;
}

function ownedIds(character: { inventory?: unknown; equipment?: unknown }): Set<string> {
    const owned = new Set<string>();
    if (Array.isArray(character.inventory)) {
        for (const id of character.inventory) if (typeof id === 'string') owned.add(id);
    }
    if (character.equipment && typeof character.equipment === 'object') {
        for (const id of Object.values(character.equipment as Record<string, unknown>)) {
            if (typeof id === 'string') owned.add(id);
        }
    }
    return owned;
}

/**
 * Pick one step item: weapon or armor at random, from the highest tier this
 * player has unlocked, preferring one they do not own yet.
 */
export function pickGearDrop(
    character: { gearTierUnlocks?: unknown; inventory?: unknown; equipment?: unknown },
    rng: (max: number) => number = randomInt,
    only?: GearKind,
): string | null {
    const unlocks = effectiveGearTierUnlocks(character);
    const kind: GearKind = only ?? (rng(2) === 0 ? 'weapon' : 'armor');
    const candidates = stepPool()[kind][Math.min(unlocks[kind], MAX_STEP_TIER)];
    if (!candidates.length) return null;
    const owned = ownedIds(character);
    const fresh = candidates.filter((id) => !owned.has(id));
    const from = fresh.length ? fresh : candidates;
    return from[rng(from.length)];
}

/** Roll `chanceBp` basis points, and on a hit pick a step item. Returns its id or null. */
export function rollGearDrop(
    character: { gearTierUnlocks?: unknown; inventory?: unknown; equipment?: unknown },
    chanceBp: number,
    rng: (max: number) => number = randomInt,
): string | null {
    if (rng(10_000) >= chanceBp) return null;
    return pickGearDrop(character, rng);
}
