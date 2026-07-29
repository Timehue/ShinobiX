/*
 * Pure logic for the Hollow Gate RIFT quests (api/sector/rift-quest.ts).
 * Unit-testable without KV / auth / locks.
 *
 * A rift is a wandering-AI quest that sends the player into a SCALED-DOWN event
 * Hollow Gate (short 1-3 floor run) with a themed final boss. Server-authoritative:
 *   accept   → seal the Hollow-Gate-boss-kill baseline (hollowGateWardenKills) + the
 *              (deterministic) target sector
 *   complete → verify the boss was killed (the counter advanced >= 1 since baseline;
 *              the shrine boss bumps hollowGateWardenKills), pay ryo + shards, stamp a
 *              post-clear cooldown; daily-capped
 * The reward is recomputed here, never trusted from the client. Nothing about the
 * Hollow Gate engine is touched.
 *
 * SOURCE OF TRUTH for reward/gate params; the client content catalog
 * (shinobij.client/src/data/hollow-rifts.ts) must stay in sync (colocated test).
 */

import { CASTLE_SECTORS, OUTSKIRTS_SECTORS, remapLegacySector, WORLD_GEO_VERSION } from '../../shared/sector-geo.js';

export const RIFT_DAILY_CAP = 3;                       // paid rift clears per UTC day
export const RIFT_COOLDOWN_MS = 6 * 60 * 60 * 1000;    // roaming giver stays quiet 6h after a clear

export interface RiftQuestDef {
    id: string;
    levelReq: number;
    floors: number;
    bossAiId: string;
    bossName: string;      // display mirror (matches the client rift.bossName)
    weight: number;        // ryo = weight*(20 + level*3)
    fateShards: number;
    boneCharms: number;
}

export const RIFT_QUESTS: Record<string, RiftQuestDef> = {
    // L12 legacy-intro rift: a gentle first taste + teaches what Legacies are.
    // Modest reward (intro tier), smaller than the L30 stalker.
    "rift-legacy-echo": {
        id: "rift-legacy-echo", levelReq: 12, bossName: "The Unremembered",
        floors: 1, bossAiId: "rift-boss-legacy-echo", weight: 5, fateShards: 1, boneCharms: 8,
    },
    "rift-hollow-stalker": {
        id: "rift-hollow-stalker", levelReq: 30, bossName: "Hollow Stalker",
        floors: 2, bossAiId: "rift-boss-hollow-stalker", weight: 8, fateShards: 1, boneCharms: 15,
    },
    "rift-beast-warren": { id: "rift-beast-warren", levelReq: 40, floors: 2, bossAiId: "rift-boss-warren-alpha", bossName: "Warren Alpha", weight: 9, fateShards: 1, boneCharms: 20 },
    "rift-engine-echo": { id: "rift-engine-echo", levelReq: 52, floors: 3, bossAiId: "rift-boss-engine-echo", bossName: "Engine-Echo", weight: 11, fateShards: 2, boneCharms: 25 },
    "rift-hollow-name": { id: "rift-hollow-name", levelReq: 62, floors: 2, bossAiId: "rift-boss-hollow-legacy", bossName: "The Hollowed Name", weight: 12, fateShards: 2, boneCharms: 30 },
    "rift-mirror-shard": { id: "rift-mirror-shard", levelReq: 70, floors: 3, bossAiId: "rift-boss-mirror-shard", bossName: "Mirror-Shard Warden", weight: 13, fateShards: 3, boneCharms: 35 },
    "rift-gate-heir": { id: "rift-gate-heir", levelReq: 80, floors: 3, bossAiId: "rift-boss-gate-heir", bossName: "Hollow Gate Heir", weight: 15, fateShards: 3, boneCharms: 45 },
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));

export function isRiftQuestId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(RIFT_QUESTS, id);
}

/** The sealed rift baseline — persisted BOTH in KV (`rift-quest:<player>`, 7d TTL)
 *  and durably on the save record (`activeRiftQuestSeal`) so an in-flight rift
 *  survives TTL expiry and the cPanel→Postgres cutover (the KV namespace was not
 *  migrated). Mirrors WandererQuestSeal / parseWandererQuestSeal.
 *  `geoV` versions the sector numbering: seals written before the 2026-07 world
 *  renumbering lack it and get their targetSector remapped once at parse time. */
export interface RiftQuestSeal {
    id: string;
    targetSector: number;
    baseline: number;
    at: number;
    geoV: number;
}

/** Validate a persisted rift seal from either store; returns null if malformed.
 *  Pre-renumbering seals (no geoV) come back remapped and re-stamped. */
export function parseRiftQuestSeal(raw: unknown): RiftQuestSeal | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : '';
    const rawTarget = Math.floor(Number(value.targetSector));
    const baseline = Number(value.baseline);
    const at = Number(value.at ?? 0);
    const geoV = Math.floor(Number(value.geoV ?? 0));
    if (!isRiftQuestId(id) || !Number.isFinite(baseline)
        || !Number.isInteger(rawTarget) || rawTarget < 1 || rawTarget > 60
        || !Number.isSafeInteger(at) || at < 0) return null;
    const targetSector = geoV >= WORLD_GEO_VERSION ? rawTarget : remapLegacySector(rawTarget);
    if (targetSector < 1 || targetSector > 60) return null;
    return { id, targetSector, baseline, at, geoV: WORLD_GEO_VERSION };
}

/** ryo for clearing a rift — the wanderer-quest band (level + effort scaled). */
export function riftQuestRyo(level: number, weight: number): number {
    return clamp(weight, 1, 20) * (20 + clamp(level, 1, 100) * 3);
}

/** The boss fell once the Hollow-Gate boss-kill counter advanced past the baseline. */
export function riftBossKilled(baseline: number, current: number): boolean {
    return (Number(current) || 0) - (Number(baseline) || 0) >= 1;
}

/**
 * Deterministic wilderness sector for a (player, rift). MUST mirror the client
 * (shinobij.client/src/lib/hollow-rifts.ts riftTargetSector) so display and seal
 * agree: same FNV-1a hash, same 1..60 draw, same skip set (village outskirts +
 * the neutral castle city — rifts open in the wilds, never in a safe hub).
 */
export function riftTargetSector(playerName: string, riftId: string): number {
    let h = 2166136261;
    const s = `${playerName}|${riftId}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    const skip = new Set([...OUTSKIRTS_SECTORS, ...CASTLE_SECTORS]);
    let sec = (Math.abs(h) % 60) + 1;
    for (let guard = 0; guard < 60 && skip.has(sec); guard++) sec = (sec % 60) + 1;
    return sec;
}
