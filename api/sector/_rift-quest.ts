/*
 * Pure logic for the Hollow Gate RIFT quests (api/sector/rift-quest.ts).
 * Unit-testable without KV / auth / locks.
 *
 * A rift is a wandering-AI quest that sends the player into a SCALED-DOWN event
 * Hollow Gate (short 1-3 floor run) with a themed final boss. Server-authoritative:
 *   accept   → seal the deterministic target sector and acceptance identity
 *   Gate     → bind that seal to one exact variant run and boss-combat receipt
 *   complete → verify the bound receipt, pay ryo + shards, stamp a post-clear
 *              cooldown and first-clear story receipt; daily-capped
 * The reward is recomputed here, never trusted from the client. Nothing about the
 * Hollow Gate engine is touched.
 *
 * SOURCE OF TRUTH for reward/gate params; the client content catalog
 * (shinobij.client/src/data/hollow-rifts.ts) must stay in sync (colocated test).
 */

import { CASTLE_SECTORS, MAX_WILD_SECTOR, OUTSKIRTS_SECTORS, remapLegacySector, WORLD_GEO_VERSION } from '../../shared/sector-geo.js';

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
    /** Exact Hollow Gate run minted for this accepted quest. Added at start. */
    runToken?: string;
}

export interface RiftQuestBossReceipt {
    riftId: string;
    runToken: string;
    combatRunId: string;
    acceptedAt: number;
    clearedAt: number;
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
    // Bound the RAW value by the current world (a post-expansion seal may name
    // 61+). A PRE-reorg seal carries an old id, which only ever went up to 60 —
    // anything above that fails remapLegacySector below and is rejected there,
    // so one bound covers both shapes.
    if (!isRiftQuestId(id) || !Number.isFinite(baseline)
        || !Number.isInteger(rawTarget) || rawTarget < 1 || rawTarget > MAX_WILD_SECTOR
        || !Number.isSafeInteger(at) || at < 0) return null;
    const targetSector = geoV >= WORLD_GEO_VERSION ? rawTarget : remapLegacySector(rawTarget);
    if (targetSector < 1 || targetSector > MAX_WILD_SECTOR) return null;
    const runToken = typeof value.runToken === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(value.runToken)
        ? value.runToken
        : undefined;
    return { id, targetSector, baseline, at, geoV: WORLD_GEO_VERSION, ...(runToken ? { runToken } : {}) };
}

export function parseRiftQuestBossReceipt(raw: unknown): RiftQuestBossReceipt | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const riftId = typeof value.riftId === 'string' ? value.riftId : '';
    const runToken = typeof value.runToken === 'string' ? value.runToken : '';
    const combatRunId = typeof value.combatRunId === 'string' ? value.combatRunId : '';
    const acceptedAt = Number(value.acceptedAt);
    const clearedAt = Number(value.clearedAt);
    if (!isRiftQuestId(riftId)
        || !/^[A-Za-z0-9_-]{8,96}$/.test(runToken)
        || !/^[A-Za-z0-9:_-]{8,96}$/.test(combatRunId)
        || !Number.isSafeInteger(acceptedAt) || acceptedAt < 0
        || !Number.isSafeInteger(clearedAt) || clearedAt < acceptedAt) return null;
    return { riftId, runToken, combatRunId, acceptedAt, clearedAt };
}

/** A generic Alpha kill cannot close a rift. The quest, Gate run and boss receipt
 * must all describe the same accepted operation. */
export function riftBossReceiptMatches(seal: RiftQuestSeal, receipt: RiftQuestBossReceipt | null): boolean {
    return Boolean(receipt
        && seal.runToken
        && receipt.riftId === seal.id
        && receipt.runToken === seal.runToken
        && receipt.acceptedAt === seal.at);
}

export interface RiftRunBindingCandidate {
    variantId?: unknown;
    runToken: unknown;
    mintedAt: unknown;
    riftQuestAcceptedAt?: unknown;
}

/**
 * Bounded rollout repair for a run minted before exact rift binding shipped.
 * The durable accepted seal, Gate variant, saved active token and server run
 * token must agree, and the run cannot predate acceptance. No aggregate counter
 * participates. The same check also validates current bindings.
 */
export function reconcileRiftRunBinding(
    seal: RiftQuestSeal | null,
    candidate: RiftRunBindingCandidate,
    savedActiveRunToken: unknown,
): { seal: RiftQuestSeal; acceptedAt: number } | null {
    if (!seal) return null;
    const runToken = typeof candidate.runToken === 'string' ? candidate.runToken : '';
    const mintedAt = Number(candidate.mintedAt);
    const acceptedAt = candidate.riftQuestAcceptedAt == null ? seal.at : Number(candidate.riftQuestAcceptedAt);
    if (!/^[A-Za-z0-9_-]{8,96}$/.test(runToken)
        || savedActiveRunToken !== runToken
        || candidate.variantId !== seal.id
        || !Number.isSafeInteger(mintedAt) || mintedAt < seal.at
        || !Number.isSafeInteger(acceptedAt) || acceptedAt !== seal.at
        || (seal.runToken != null && seal.runToken !== runToken)) return null;
    return { seal: { ...seal, runToken }, acceptedAt: seal.at };
}

/** ryo for clearing a rift — the wanderer-quest band (level + effort scaled). */
export function riftQuestRyo(level: number, weight: number): number {
    return clamp(weight, 1, 20) * (20 + clamp(level, 1, 100) * 3);
}

/** Legacy diagnostic retained for old counter behavior tests; never reward proof. */
export function riftBossKilled(baseline: number, current: number): boolean {
    return (Number(current) || 0) - (Number(baseline) || 0) >= 1;
}

/**
 * Deterministic wilderness sector for a (player, rift). MUST mirror the client
 * (shinobij.client/src/lib/hollow-rifts.ts riftTargetSector) so display and seal
 * agree: same FNV-1a hash, same 1..MAX_WILD_SECTOR draw, same skip set (village
 * outskirts + the neutral castle city — rifts open in the wilds, never in a hub).
 *
 * The draw spans MAX_WILD_SECTOR, so sectors added later become rift homes too.
 * Widening it is safe for quests already underway: `accept` SEALS the drawn
 * sector into activeRiftQuest.targetSector and the durable activeRiftQuestSeal,
 * and nothing re-derives it afterwards — this is only ever called to offer or to
 * accept. The worst case across a deploy is a stale client PREVIEW showing a
 * different sector than the one the server then seals, which the accept response
 * corrects immediately.
 */
export function riftTargetSector(playerName: string, riftId: string): number {
    let h = 2166136261;
    const s = `${playerName}|${riftId}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    const skip = new Set([...OUTSKIRTS_SECTORS, ...CASTLE_SECTORS]);
    let sec = (Math.abs(h) % MAX_WILD_SECTOR) + 1;
    for (let guard = 0; guard < MAX_WILD_SECTOR && skip.has(sec); guard++) sec = (sec % MAX_WILD_SECTOR) + 1;
    return sec;
}
