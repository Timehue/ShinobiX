/**
 * Hollow Gate — Shrine Attunement (Phase 3B): permanent, between-run upgrades
 * bought with Hollow Shards. Pure catalog + buy + effect getters + a run-start
 * applier, kept out of App.tsx. Ranks persist on Character.hollowGateAttunement
 * (server-clamped in api/save). See docs/hollow-gate-loop.md §7B.
 *
 * Costs/values are tunable balance knobs.
 */
import type { Character, HollowGateShrineRun } from "../types/character";
import { addInventoryItems } from "./items";
import { HOLLOW_GATE_KEY_ID } from "../constants/game";

export type AttunementNode = {
    id: string;
    label: string;
    desc: string;
    baseCost: number;       // cost of rank 1; rank N costs baseCost * N
    maxRank: number;
    comingSoon?: boolean;
};

export const ATTUNEMENT_NODES: AttunementNode[] = [
    { id: "seasoned-delver", label: "Seasoned Delver", desc: "Begin each run holding +1 Shrine Key per rank.", baseCost: 30, maxRank: 2 },
    { id: "reiki-reserves", label: "Reiki Reserves", desc: "Begin each run under a Hollow Ward for 3 steps per rank.", baseCost: 30, maxRank: 2 },
    { id: "cartographer", label: "Cartographer", desc: "The descent is revealed at the start of every floor.", baseCost: 40, maxRank: 1 },
    { id: "greedy-hands", label: "Greedy Hands", desc: "Keep +10% more of your haul when you die, per rank.", baseCost: 45, maxRank: 3 },
    { id: "extra-dive", label: "Extra Dive", desc: "Enter the shrine +1 more time per day.", baseCost: 120, maxRank: 1 },
    { id: "key-forge", label: "Key Forge", desc: "Unlock forging Hollow Gate Keys from shards at the shrine.", baseCost: 150, maxRank: 1 },
];

const byId = new Map(ATTUNEMENT_NODES.map((n) => [n.id, n]));

export function attunementRank(character: Character, id: string): number {
    return character.hollowGateAttunement?.[id] ?? 0;
}

/** Cost of the NEXT rank of a node, or null if maxed / unknown. */
export function attunementNextCost(character: Character, id: string): number | null {
    const node = byId.get(id);
    if (!node) return null;
    const rank = attunementRank(character, id);
    if (rank >= node.maxRank) return null;
    return node.baseCost * (rank + 1);
}

export type BuyResult = { ok: true; character: Character } | { ok: false; reason: string };

/** Purchase the next rank of a node, spending Hollow Shards. Pure. */
export function buyAttunement(character: Character, id: string): BuyResult {
    const node = byId.get(id);
    if (!node || node.comingSoon) return { ok: false, reason: "That attunement isn't available yet." };
    const cost = attunementNextCost(character, id);
    if (cost == null) return { ok: false, reason: "Already at maximum rank." };
    if ((character.hollowShards ?? 0) < cost) return { ok: false, reason: "Not enough Hollow Shards." };
    const rank = attunementRank(character, id);
    return {
        ok: true,
        character: {
            ...character,
            hollowShards: (character.hollowShards ?? 0) - cost,
            hollowGateAttunement: { ...(character.hollowGateAttunement ?? {}), [id]: rank + 1 },
        },
    };
}

// ── Effect getters (read by the run/death logic) ─────────────────────────────
export const attunementStartKeys = (c: Character) => attunementRank(c, "seasoned-delver");
export const attunementStartWard = (c: Character) => attunementRank(c, "reiki-reserves") * 3;
export const attunementCartographer = (c: Character) => attunementRank(c, "cartographer") > 0;
export const attunementDailyBonus = (c: Character) => attunementRank(c, "extra-dive");
/** Fraction of the run's haul KEPT on death (0.5 base, +0.1 per Greedy Hands rank, cap 0.8). */
export const attunementLootRetention = (c: Character) => Math.min(0.8, 0.5 + attunementRank(c, "greedy-hands") * 0.1);

/**
 * Apply the attunement run-start bonuses to a freshly-generated run. `firstFloor`
 * gates the once-per-run bonuses (starting keys + opening ward); Cartographer's
 * descent reveal applies on every floor.
 */
export function applyAttunementToRun(run: HollowGateShrineRun, character: Character, firstFloor: boolean): HollowGateShrineRun {
    let next = run;
    if (firstFloor) {
        const keys = attunementStartKeys(character);
        const ward = attunementStartWard(character);
        if (keys > 0 || ward > 0) next = { ...next, keys: next.keys + keys, wardSteps: (next.wardSteps ?? 0) + ward };
    }
    if (attunementCartographer(character)) {
        next = { ...next, tiles: next.tiles.map((t) => (t.kind === "descend" || t.kind === "boss") ? { ...t, revealed: true } : t) };
    }
    return next;
}

// ── Key Forge ────────────────────────────────────────────────────────────────
// Once the Key Forge node is attuned, the player can convert Hollow Shards into
// Hollow Gate Keys at the shrine — the self-sustaining entry loop.
export const KEY_FORGE_COST = 60;
export const keyForgeUnlocked = (c: Character) => attunementRank(c, "key-forge") > 0;

export function forgeHollowGateKey(character: Character): BuyResult {
    if (!keyForgeUnlocked(character)) return { ok: false, reason: "The Key Forge is not yet attuned." };
    if ((character.hollowShards ?? 0) < KEY_FORGE_COST) return { ok: false, reason: "Not enough Hollow Shards." };
    const spent: Character = { ...character, hollowShards: (character.hollowShards ?? 0) - KEY_FORGE_COST };
    return { ok: true, character: addInventoryItems(spent, [HOLLOW_GATE_KEY_ID]) };
}
