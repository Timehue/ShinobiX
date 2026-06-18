/**
 * Hollow Gate — run economy helpers (loot snapshot, death claw-back, shard
 * drops). Pure functions, no React/App coupling, so they're unit-testable and
 * keep this logic out of App.tsx (which is at its line-budget ceiling).
 *
 * Death model (per docs/hollow-gate-loop.md): a run death forfeits the entry
 * Key but the player KEEPS 50% of the currencies earned this run (and all XP,
 * pets, and unique items). Rather than tally every reward grant, we snapshot
 * the clawback-eligible currencies at run entry (`entryCurrencies`) and, on
 * death, claw back 50% of the net gain since entry. The shrine is nav-locked
 * (see lib/screen-guards), so between entry and death the only currency changes
 * are the dungeon's own — making `current − entry` exactly the run's haul.
 */
import type { Character, HollowGateShrineRun } from "../types/character";

// Currencies subject to the 50% death claw-back. XP, pets, and unique items are
// intentionally excluded (kept in full). Honor Seals are listed for
// completeness — they're only granted by the F5 boss, which leads to extraction
// (not a mid-run death), so in practice they're rarely at risk.
export const HOLLOW_GATE_CLAWBACK_KEYS = [
    "ryo",
    "auraDust",
    "auraStones",
    "boneCharms",
    "fateShards",
    "honorSeals",
    "hollowShards",
] as const;

export type HollowGateCurrencyKey = (typeof HOLLOW_GATE_CLAWBACK_KEYS)[number];
export type HollowGateCurrencySnapshot = Partial<Record<HollowGateCurrencyKey, number>>;

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * Snapshot the clawback-eligible currency balances of a character. Stored on the
 * run as `entryCurrencies` at the moment the run begins.
 */
export function snapshotHollowGateCurrencies(character: Character): HollowGateCurrencySnapshot {
    const snap: HollowGateCurrencySnapshot = {};
    for (const key of HOLLOW_GATE_CLAWBACK_KEYS) {
        snap[key] = num((character as Record<string, unknown>)[key]);
    }
    return snap;
}

/**
 * Apply the death claw-back: return a copy of `character` with 50% of each
 * currency earned during this run removed. "Earned" = current balance minus the
 * run's entry snapshot (floored at 0), so spending currency mid-run can never
 * push the claw-back negative, and a balance can never drop below its entry
 * value. If the run has no snapshot (legacy in-progress runs saved before this
 * shipped), nothing is clawed back.
 */
export function clawBackHollowGateLoot(character: Character, run: HollowGateShrineRun): Character {
    const entry = run.entryCurrencies;
    if (!entry) return character;
    const next: Record<string, unknown> = { ...(character as Record<string, unknown>) };
    for (const key of HOLLOW_GATE_CLAWBACK_KEYS) {
        const current = num(next[key]);
        const earned = Math.max(0, current - num(entry[key]));
        const lost = Math.floor(earned * 0.5);
        if (lost > 0) next[key] = current - lost;
    }
    return next as unknown as Character;
}

/**
 * How many of this run's earned currencies would be lost on death right now.
 * Drives the death-screen "kept vs lost" summary and the Sanctify Loot preview.
 */
export function hollowGateClawBackPreview(character: Character, run: HollowGateShrineRun): HollowGateCurrencySnapshot {
    const entry = run.entryCurrencies;
    const out: HollowGateCurrencySnapshot = {};
    if (!entry) return out;
    const c = character as Record<string, unknown>;
    for (const key of HOLLOW_GATE_CLAWBACK_KEYS) {
        const earned = Math.max(0, num(c[key]) - num(entry[key]));
        const lost = Math.floor(earned * 0.5);
        if (lost > 0) out[key] = lost;
    }
    return out;
}

/**
 * Depth-scaled Hollow Shard payout for a drop source. Shards are a
 * Hollow-Gate-only currency spent on in-run consumables + the Shrine Attunement
 * tree (see docs/hollow-gate-loop.md §7). Tunable — these are starting values.
 */
export function hollowShardDrop(floor: number, source: "chest" | "lockedChest" | "boss"): number {
    const f = Math.max(1, Math.floor(floor));
    switch (source) {
        case "chest":
            return 2 + f;                 // F1=3 … F5=7
        case "lockedChest":
            return 5 + f * 2;             // F1=7 … F5=15
        case "boss":
            return 15 + f * 5;            // F5=40
        default:
            return 0;
    }
}
