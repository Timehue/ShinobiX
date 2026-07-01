import { randomUUID } from 'node:crypto';

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
export const HG_CLAWBACK_KEYS = [
    'ryo', 'auraDust', 'auraStones', 'boneCharms', 'fateShards', 'honorSeals', 'hollowShards',
] as const;
export type HgCurrencyKey = (typeof HG_CLAWBACK_KEYS)[number];

// VERBATIM mirror of the client hollowShardDrop (lib/hollow-gate-run.ts). The
// drift test asserts this matches the client for every floor/source.
export function hollowShardDrop(floor: number, source: 'chest' | 'lockedChest' | 'boss' | 'shardVein'): number {
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
const TILE_BUDGET = { chest: 6, shardVein: 5, lockedChest: 3 } as const;

/** Max hollowShards a depth-`depth` run could legitimately yield (generous). */
export function maxShardsForDepth(depth: number): number {
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
const PER_DEPTH_CEIL: Record<Exclude<HgCurrencyKey, 'hollowShards'>, number> = {
    ryo: 8000, auraDust: 300, auraStones: 15, boneCharms: 15, fateShards: 6, honorSeals: 6,
};

/** Per-currency reward ceiling for a run, after the sealed augment multiplier. */
export function maxHaulForDepth(depth: number, rewardMultiplier = 1): Record<HgCurrencyKey, number> {
    const d = Math.max(1, Math.min(20, Math.floor(depth)));
    const mult = Math.max(1, Number(rewardMultiplier) || 1);
    const out = {} as Record<HgCurrencyKey, number>;
    out.hollowShards = Math.ceil(maxShardsForDepth(d) * mult);
    for (const k of Object.keys(PER_DEPTH_CEIL) as (keyof typeof PER_DEPTH_CEIL)[]) {
        out[k] = Math.ceil(d * PER_DEPTH_CEIL[k] * mult);
    }
    return out;
}

// ─── High-value ITEM drops (P0.2c) ─────────────────────────────────────────────
// The clawback ceilings above bound the run's CURRENCY haul. The boss also drops a
// discrete high-value ITEM (the Dungeon Legendary Fragment, an epic forge material)
// that the per-save sanitizer does NOT per-item cap (only the blanket INVENTORY_CAP).
// To make that drop server-authoritative WITHOUT deferring the grant (which would
// risk losing a legit fragment on an un-settled run), we take the same shape as the
// currency ceiling: START seals the entry fragment count, and SETTLE clamps the run's
// GAIN (current − entry) to maxFragmentsForDepth. Legit hauls sit under the ceiling
// so the clamp is a no-op (byte-identical); only a crafted client's excess is clawed
// back. Fragments live as counted `itemStacks` (data/pet-config.ts). Mirror of
// DUNGEON_LEGENDARY_FRAGMENT_ID in shinobij.client/src/constants/game.ts (drift-guarded).
export const HG_HIGH_VALUE_ITEM_ID = 'dungeon-legendary-fragment';

/** Max Dungeon Legendary Fragments a depth-`depth` run may GAIN. Deliberately
 *  generous (≈2 per floor of depth) — a too-low ceiling would wrongly confiscate a
 *  legit multi-boss haul, while any finite ceiling still closes the unbounded-mint
 *  exploit. Backstopped by the per-save itemStacks caps. */
export function maxFragmentsForDepth(depth: number): number {
    return Math.max(2, Math.min(40, Math.floor(Number(depth) || 1) * 2));
}

/** Count of a given item id held as counted `itemStacks` ([{itemId,count}]). Used
 *  to seal the entry baseline at START and to read the run total at SETTLE. */
export function itemStackCount(itemStacks: unknown, itemId: string): number {
    if (!Array.isArray(itemStacks)) return 0;
    let total = 0;
    for (const s of itemStacks as Array<Record<string, unknown>>) {
        if (s && typeof s === 'object' && String(s.itemId ?? '') === itemId) {
            total += Math.max(0, Math.floor(Number(s.count) || 0));
        }
    }
    return total;
}

/** Pure: the allowed post-run fragment total. Clamps the GAIN (current − entry) to
 *  the ceiling; never restores an in-run spend (min with current), never drops below
 *  the sealed entry (don't confiscate pre-run fragments). Death does NOT claw items
 *  back — the inline grant already keeps them (behavior-preserving, unlike currency). */
export function clampFragmentTotal(current: unknown, entry: unknown, ceiling: number): number {
    const cur = Math.max(0, Math.floor(Number(current) || 0));
    const ent = Math.max(0, Math.floor(Number(entry) || 0));
    const cap = Math.max(0, Math.floor(Number(ceiling) || 0));
    return Math.max(0, Math.min(cur, ent + cap));
}

// ─── Augments ─────────────────────────────────────────────────────────────────
// combat = client-side feel (UNTRUSTED, changes how the run plays, never payout).
// rewardMultiplier = the ONLY server-enforced effect (sealed in the token).
export interface Augment {
    id: string;
    label: string;
    description: string;
    rarity: 'common' | 'rare';
    combat?: { kind: string; value: number };
    rewardMultiplier: number;
    riskLabel?: string;
}

export const AUGMENT_CATALOG: Record<string, Augment> = {
    'keen-edge':      { id: 'keen-edge',      label: 'Keen Edge',        description: '+20% damage dealt this dive.',          rarity: 'common', combat: { kind: 'damageBonus', value: 0.20 }, rewardMultiplier: 1.2 },
    'warded-step':    { id: 'warded-step',    label: 'Warded Step',      description: 'Start each floor with a small shield.', rarity: 'common', combat: { kind: 'roleShield', value: 0.15 }, rewardMultiplier: 1.2 },
    'chain-reaction': { id: 'chain-reaction', label: 'Chain Reaction',   description: 'Hits occasionally arc to a second foe.', rarity: 'common', combat: { kind: 'chainHit', value: 1 }, rewardMultiplier: 1.3 },
    'treasure-sense': { id: 'treasure-sense', label: 'Treasure Sense',   description: 'Richer hoard — but fewer healing tiles.', rarity: 'rare', rewardMultiplier: 1.6, riskLabel: 'Fewer healing tiles' },
    'greedy-pact':    { id: 'greedy-pact',    label: 'Greedy Pact',      description: 'Double the loot — enemies hit harder.',  rarity: 'rare', combat: { kind: 'enemyPower', value: 0.30 }, rewardMultiplier: 2.0, riskLabel: 'Enemies +30% power' },
    'berserkers-gamble': { id: 'berserkers-gamble', label: "Berserker's Gamble", description: 'Big haul, but no retreat once you descend.', rarity: 'rare', combat: { kind: 'lifesteal', value: 0.10 }, rewardMultiplier: 1.8, riskLabel: 'No retreat' },
};

/** The display-only shape sent to the client (no internal fields beyond these). */
export function augmentDisplay(a: Augment) {
    return { id: a.id, label: a.label, description: a.description, rarity: a.rarity, riskLabel: a.riskLabel, combat: a.combat };
}

/** Server-rolled offer set — the client can't choose which augments are offered. */
export function rollAugmentOffers(count = 3): Augment[] {
    const ids = Object.keys(AUGMENT_CATALOG);
    // Fisher-Yates with crypto-seeded indices (server-only RNG is fine here).
    for (let i = ids.length - 1; i > 0; i--) {
        const r = randomUUID().replace(/-/g, '');
        const j = parseInt(r.slice(0, 8), 16) % (i + 1);
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids.slice(0, Math.max(1, Math.min(count, ids.length))).map((id) => AUGMENT_CATALOG[id]);
}

export interface HollowGateRunToken {
    playerName: string;
    mintedAt: number;
    floorDepth: number;
    seed: string;
    entryCurrencies: Partial<Record<HgCurrencyKey, number>>;
    // P0.2c: entry count of the high-value forge item (Dungeon Legendary Fragment)
    // so settle can clamp the run's GAIN to the ceiling. Optional: tokens minted
    // before this field existed skip the item clamp (settle guards on typeof).
    entryFragments?: number;
    offeredAugmentIds: string[];
    chosenAugmentId: string | null;
    dailyRunOrdinal: number;
}

export function rewardMultiplierForToken(t: Pick<HollowGateRunToken, 'chosenAugmentId'>): number {
    const a = t.chosenAugmentId ? AUGMENT_CATALOG[t.chosenAugmentId] : undefined;
    return a ? a.rewardMultiplier : 1;
}
