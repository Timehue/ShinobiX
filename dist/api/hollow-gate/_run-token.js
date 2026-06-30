"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUGMENT_CATALOG = exports.HG_CLAWBACK_KEYS = void 0;
exports.hollowShardDrop = hollowShardDrop;
exports.maxShardsForDepth = maxShardsForDepth;
exports.maxHaulForDepth = maxHaulForDepth;
exports.augmentDisplay = augmentDisplay;
exports.rollAugmentOffers = rollAugmentOffers;
exports.rewardMultiplierForToken = rewardMultiplierForToken;
const node_crypto_1 = require("node:crypto");
/*
 * Hollow Gate — server-authoritative run token + augment layer (Tier 1).
 *
 * The trust model (docs/hollow-gate-augments.md): at dive START the server seals
 * the entry currency snapshot + dive depth + the chosen augment's REWARD
 * multiplier into a token; at SETTLE it credits min(client-claimed, server
 * ceiling) anchored to the sealed snapshot. The augment's COMBAT effect is
 * applied client-side for feel and never trusted — only the single sealed
 * rewardMultiplier is enforced. This module is the pure core (catalog + bound
 * math + offer roll); the endpoints (start/choose-augment/settle) wrap it.
 *
 * Tier 1 = "sealed bounds": maxHaulForDepth caps a run to a legitimate ceiling
 * WITHOUT re-simulating the dungeon. The hollowShards ceiling mirrors the client
 * hollowShardDrop curve verbatim (a drift test pins them equal); the other
 * clawback currencies get deliberately GENEROUS per-depth ceilings (loose now,
 * tighten once telemetry exists) — they're additionally backstopped by the
 * per-save gain caps in api/save/[name].ts. Tier 2 (deterministic regen) deferred.
 */
// Mirror of shinobij.client/src/lib/hollow-gate-run.ts HOLLOW_GATE_CLAWBACK_KEYS.
// KEEP IN SYNC (the drift test imports the client list and asserts equality).
exports.HG_CLAWBACK_KEYS = [
    'ryo', 'auraDust', 'auraStones', 'boneCharms', 'fateShards', 'honorSeals', 'hollowShards',
];
// VERBATIM mirror of the client hollowShardDrop (lib/hollow-gate-run.ts). The
// drift test asserts this matches the client for every floor/source.
function hollowShardDrop(floor, source) {
    const f = Math.max(1, Math.floor(floor));
    switch (source) {
        case 'chest': return 2 + f;
        case 'shardVein': return 3 + f * 2;
        case 'lockedChest': return 5 + f * 2;
        case 'boss': return 15 + f * 5;
        default: return 0;
    }
}
// Generous per-floor loot-tile budget for the Tier-1 ceiling. Real floors carry
// fewer of each, so this over-counts on purpose: a too-LOW ceiling would
// wrongly confiscate a legit haul, while a loose-but-finite ceiling still closes
// the unbounded-farming exploit (#6). Tunable down once telemetry lands.
const TILE_BUDGET = { chest: 6, shardVein: 5, lockedChest: 3 };
/** Max hollowShards a depth-`depth` run could legitimately yield (generous). */
function maxShardsForDepth(depth) {
    const d = Math.max(1, Math.min(20, Math.floor(depth)));
    let total = 0;
    for (let f = 1; f <= d; f++) {
        total += TILE_BUDGET.chest * hollowShardDrop(f, 'chest')
            + TILE_BUDGET.shardVein * hollowShardDrop(f, 'shardVein')
            + TILE_BUDGET.lockedChest * hollowShardDrop(f, 'lockedChest');
    }
    total += hollowShardDrop(d, 'boss'); // boss at the final floor
    return total;
}
// Loose per-depth ceilings for the non-shard clawback currencies (per floor of
// depth). Backstopped by the per-save gain caps; tighten with telemetry.
const PER_DEPTH_CEIL = {
    ryo: 8000, auraDust: 300, auraStones: 15, boneCharms: 15, fateShards: 6, honorSeals: 6,
};
/** Per-currency reward ceiling for a run, after the sealed augment multiplier. */
function maxHaulForDepth(depth, rewardMultiplier = 1) {
    const d = Math.max(1, Math.min(20, Math.floor(depth)));
    const mult = Math.max(1, Number(rewardMultiplier) || 1);
    const out = {};
    out.hollowShards = Math.ceil(maxShardsForDepth(d) * mult);
    for (const k of Object.keys(PER_DEPTH_CEIL)) {
        out[k] = Math.ceil(d * PER_DEPTH_CEIL[k] * mult);
    }
    return out;
}
exports.AUGMENT_CATALOG = {
    'keen-edge': { id: 'keen-edge', label: 'Keen Edge', description: '+20% damage dealt this dive.', rarity: 'common', combat: { kind: 'damageBonus', value: 0.20 }, rewardMultiplier: 1.2 },
    'warded-step': { id: 'warded-step', label: 'Warded Step', description: 'Start each floor with a small shield.', rarity: 'common', combat: { kind: 'roleShield', value: 0.15 }, rewardMultiplier: 1.2 },
    'chain-reaction': { id: 'chain-reaction', label: 'Chain Reaction', description: 'Hits occasionally arc to a second foe.', rarity: 'common', combat: { kind: 'chainHit', value: 1 }, rewardMultiplier: 1.3 },
    'treasure-sense': { id: 'treasure-sense', label: 'Treasure Sense', description: 'Richer hoard — but fewer healing tiles.', rarity: 'rare', rewardMultiplier: 1.6, riskLabel: 'Fewer healing tiles' },
    'greedy-pact': { id: 'greedy-pact', label: 'Greedy Pact', description: 'Double the loot — enemies hit harder.', rarity: 'rare', combat: { kind: 'enemyPower', value: 0.30 }, rewardMultiplier: 2.0, riskLabel: 'Enemies +30% power' },
    'berserkers-gamble': { id: 'berserkers-gamble', label: "Berserker's Gamble", description: 'Big haul, but no retreat once you descend.', rarity: 'rare', combat: { kind: 'lifesteal', value: 0.10 }, rewardMultiplier: 1.8, riskLabel: 'No retreat' },
};
/** The display-only shape sent to the client (no internal fields beyond these). */
function augmentDisplay(a) {
    return { id: a.id, label: a.label, description: a.description, rarity: a.rarity, riskLabel: a.riskLabel, combat: a.combat };
}
/** Server-rolled offer set — the client can't choose which augments are offered. */
function rollAugmentOffers(count = 3) {
    const ids = Object.keys(exports.AUGMENT_CATALOG);
    // Fisher-Yates with crypto-seeded indices (server-only RNG is fine here).
    for (let i = ids.length - 1; i > 0; i--) {
        const r = (0, node_crypto_1.randomUUID)().replace(/-/g, '');
        const j = parseInt(r.slice(0, 8), 16) % (i + 1);
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids.slice(0, Math.max(1, Math.min(count, ids.length))).map((id) => exports.AUGMENT_CATALOG[id]);
}
function rewardMultiplierForToken(t) {
    const a = t.chosenAugmentId ? exports.AUGMENT_CATALOG[t.chosenAugmentId] : undefined;
    return a ? a.rewardMultiplier : 1;
}
