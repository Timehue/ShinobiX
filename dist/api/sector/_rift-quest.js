"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RIFT_QUESTS = exports.RIFT_COOLDOWN_MS = exports.RIFT_DAILY_CAP = void 0;
exports.isRiftQuestId = isRiftQuestId;
exports.riftQuestRyo = riftQuestRyo;
exports.riftBossKilled = riftBossKilled;
exports.riftTargetSector = riftTargetSector;
exports.RIFT_DAILY_CAP = 3; // paid rift clears per UTC day
exports.RIFT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // roaming giver stays quiet 6h after a clear
exports.RIFT_QUESTS = {
    // L12 legacy-intro rift: a gentle first taste + teaches what Legacies are.
    // Modest reward (intro tier), smaller than the L30 stalker.
    "rift-legacy-echo": {
        id: "rift-legacy-echo", levelReq: 12, bossName: "The Unremembered",
        weight: 5, fateShards: 1, boneCharms: 8,
    },
    "rift-hollow-stalker": {
        id: "rift-hollow-stalker", levelReq: 30, bossName: "Hollow Stalker",
        weight: 8, fateShards: 1, boneCharms: 15,
    },
    "rift-beast-warren": { id: "rift-beast-warren", levelReq: 40, bossName: "Warren Alpha", weight: 9, fateShards: 1, boneCharms: 20 },
    "rift-engine-echo": { id: "rift-engine-echo", levelReq: 52, bossName: "Engine-Echo", weight: 11, fateShards: 2, boneCharms: 25 },
    "rift-hollow-name": { id: "rift-hollow-name", levelReq: 62, bossName: "The Hollowed Name", weight: 12, fateShards: 2, boneCharms: 30 },
    "rift-mirror-shard": { id: "rift-mirror-shard", levelReq: 70, bossName: "Mirror-Shard Warden", weight: 13, fateShards: 3, boneCharms: 35 },
    "rift-gate-heir": { id: "rift-gate-heir", levelReq: 80, bossName: "Hollow Gate Heir", weight: 15, fateShards: 3, boneCharms: 45 },
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));
function isRiftQuestId(id) {
    return Object.prototype.hasOwnProperty.call(exports.RIFT_QUESTS, id);
}
/** ryo for clearing a rift — the wanderer-quest band (level + effort scaled). */
function riftQuestRyo(level, weight) {
    return clamp(weight, 1, 20) * (20 + clamp(level, 1, 100) * 3);
}
/** The boss fell once the Hollow-Gate boss-kill counter advanced past the baseline. */
function riftBossKilled(baseline, current) {
    return (Number(current) || 0) - (Number(baseline) || 0) >= 1;
}
/**
 * Deterministic wilderness sector for a (player, rift). MUST mirror the client
 * (shinobij.client/src/lib/hollow-rifts.ts riftTargetSector) so display and seal
 * agree: same FNV-1a hash, same 1..55 wilderness range, same village-outskirts skip.
 */
function riftTargetSector(playerName, riftId) {
    let h = 2166136261;
    const s = `${playerName}|${riftId}`;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const villages = new Set([11, 31, 38, 47]);
    let sec = (Math.abs(h) % 55) + 1;
    for (let guard = 0; guard < 60 && villages.has(sec); guard++)
        sec = (sec % 55) + 1;
    return sec;
}
