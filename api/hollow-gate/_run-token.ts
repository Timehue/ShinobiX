import { randomUUID } from 'node:crypto';
import type { HollowGateActiveEncounter } from './_combat-session.js';
import {
    HOLLOW_GATE_DEPTH,
    canonicalHollowGateDepth as canonicalSharedHollowGateDepth,
} from '../../shared/hollow-gate-contract.js';
import type { HollowGateRewardLedger, HollowGateLedgerItemId } from './_ledger.js';
import type { HollowGateFloorManifest } from './_floor-manifest.js';

// The run token seals entry, depth, augment choice, exact reward credits, and
// single-use settlement. Combat is resolved through a run-bound server session.
export const HOLLOW_GATE_RUNS_ENABLED = true;

export function hollowGateRunsEnabled(): boolean {
    return HOLLOW_GATE_RUNS_ENABLED;
}

/** The KV key holding a live run token. The run is gone — settled or died —
 *  exactly when this key is absent, which is what the endpoints
 *  below report as an expired run. The save-read self-heal (api/_elapsed-state.ts)
 *  probes the same key, so every producer/consumer shares this helper rather than
 *  re-spelling the literal. `playerName` is always a safeName slug. */
export function hollowGateRunKey(playerName: string, token: string): string {
    return `hg-run:${playerName}:${token}`;
}

/** Every "this run is gone" message a run endpoint returns alongside its 409.
 *  An expired run used to strand the player: the shrine is deliberately
 *  no-retreat (lib/screen-guards.ts) and the run persists on the SAVE, so a
 *  dismissed error just looped them back into a dead gate. The client matcher
 *  (shinobij.client/src/lib/hollow-gate-server.ts isHollowGateRunExpiredMessage)
 *  turns any of these into a clear-and-exit. KEEP IN SYNC — a drift test imports
 *  this list and asserts the client recognises every entry. */
export const HOLLOW_GATE_RUN_EXPIRED_MESSAGES = {
    combatStart: 'The Hollow Gate run has expired.',
    combatSettle: 'The Hollow Gate run expired before settlement.',
    descend: 'The Hollow Gate run expired before descent.',
    consumable: 'The Hollow Gate run expired.',
} as const;

/*
 * Hollow Gate — server-authoritative run token + augment layer.
 *
 * START seals the entry snapshot and run identity. Every reward-bearing event
 * records an idempotent server-derived credit in rewardLedger; SETTLE reconciles
 * the stored character against that exact ledger. Combat modifiers are enforced
 * by the server-owned solo-PvE session.
 */

// Mirror of shinobij.client/src/lib/hollow-gate-run.ts HOLLOW_GATE_CLAWBACK_KEYS.
// KEEP IN SYNC (the drift test imports the client list and asserts equality).
export const HG_CLAWBACK_KEYS = [
    'ryo', 'auraDust', 'auraStones', 'boneCharms', 'fateShards', 'honorSeals', 'hollowShards',
] as const;
export type HgCurrencyKey = (typeof HG_CLAWBACK_KEYS)[number];

// Public alias retained for endpoint/tests that name the server-side envelope.
// The actual contract lives in shared/ so the browser cannot drift from it.
export const HOLLOW_GATE_SERVER_DEPTH = HOLLOW_GATE_DEPTH;

export function canonicalHollowGateDepth(requested?: unknown): number {
    return canonicalSharedHollowGateDepth(requested);
}

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

// Counted item identity retained for the exact entry/ledger reconciliation.
export const HG_HIGH_VALUE_ITEM_ID = 'dungeon-legendary-fragment';

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

// ─── Augments ─────────────────────────────────────────────────────────────────
// Both combat and reward effects are derived from the chosen server token.
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
    'berserkers-gamble': { id: 'berserkers-gamble', label: "Berserker's Gamble", description: '+10% damage and a bigger haul, but no retreat.', rarity: 'rare', combat: { kind: 'damageBonus', value: 0.10 }, rewardMultiplier: 1.8, riskLabel: 'No retreat' },
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
    currentFloor?: number;
    seed: string;
    entryCurrencies: Partial<Record<HgCurrencyKey, number>>;
    // Compatibility baseline for tokens minted before entryItems covered every
    // counted reward item.
    entryFragments?: number;
    /** Entry baselines for every counted item the run can award. */
    entryItems?: Partial<Record<HollowGateLedgerItemId, number>>;
    offeredAugmentIds: string[];
    chosenAugmentId: string | null;
    dailyRunOrdinal: number;
    variantId?: string;
    /** Present only for a server-authorized wandering rift run. Completion uses
     * this with the exact run token and boss combat receipt. */
    riftQuestAcceptedAt?: number;
    /** Server-sealed generated board shape. Event variants may be compact, but
     * the browser cannot choose a cheaper geometry than the published variant. */
    floorWidth?: number;
    floorHeight?: number;
    bossProfileId?: string;
    bossName?: string;
    /** One server combat may be active at a time. Settlement moves its encounter
     * key into resolvedEncounterIds before another fight can start. */
    activeEncounter?: HollowGateActiveEncounter | null;
    resolvedEncounterIds?: string[];
    /** Server-owned dungeon resources and one-time non-combat event identities. */
    keys?: number;
    torch?: number;
    threat?: number;
    resolvedEventIds?: string[];
    position?: { x: number; y: number };
    stepVersion?: number;
    recentStepIds?: string[];
    recentConsumableIds?: string[];
    wardSteps?: number;
    divinerUsed?: boolean;
    pendingAmbush?: { nodeId: string; kind: 'ambush' | 'boss' } | null;
    floorManifests?: Record<string, HollowGateFloorManifest>;
    /** Currency already committed by authoritative combat. Final extraction
     * treats this as a stored baseline, so a stale browser cannot erase it. */
    serverCreditedCurrencies?: Partial<Record<HgCurrencyKey, number>>;
    /** Canonical exact run economy. serverCreditedCurrencies remains only for
     * tokens minted before the ledger cutover. */
    rewardLedger?: HollowGateRewardLedger;
    secondWindArmed?: boolean;
}

export function rewardMultiplierForToken(t: Pick<HollowGateRunToken, 'chosenAugmentId'>): number {
    const a = t.chosenAugmentId ? AUGMENT_CATALOG[t.chosenAugmentId] : undefined;
    return a ? a.rewardMultiplier : 1;
}
