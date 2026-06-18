/**
 * Hollow Gate — in-run Hollow Shard consumables (Phase 3 sinks).
 *
 * Pure catalog + apply logic, kept out of App.tsx. Shards are spent from the
 * player's Character.hollowShards balance during a run; each consumable mutates
 * the run state (or arms a death-time effect). See docs/hollow-gate-loop.md §7.
 *
 * Starting costs/values are tunable — they're balance knobs, nothing depends on
 * the exact numbers.
 */
import type { Character, HollowGateShrineRun } from "../types/character";
import { snapshotHollowGateCurrencies } from "./hollow-gate-run";

export type HollowShardConsumable = {
    id: string;
    label: string;
    cost: number;
    desc: string;
    icon: string;          // tabler icon name (UI)
    once?: boolean;        // true = can only be used once per run
    comingSoon?: boolean;  // logic + tests ready, but not yet surfaced in the UI
};

// NOTE: shard costs are balance knobs (Phase 4 first-cut values, pending
// playtest). Cheap utilities (reignite/key) stay spammable; the strong
// run-savers (ward/diviner/second-wind) cost more so they're deliberate.
export const HOLLOW_SHARD_CONSUMABLES: HollowShardConsumable[] = [
    { id: "reignite", label: "Reignite Torch", cost: 6, icon: "flame", desc: "Refill the Torch of Reiki to full." },
    { id: "skeleton-key", label: "Skeleton Key", cost: 8, icon: "key", desc: "Gain a Shrine Key to open one sealed door." },
    { id: "hollow-ward", label: "Hollow Ward", cost: 14, icon: "shield-half", desc: "Wipe Threat and hold it back for 6 steps." },
    { id: "diviner-eye", label: "Diviner's Eye", cost: 16, icon: "eye", desc: "Reveal the entire floor.", once: true },
    { id: "sanctify", label: "Sanctify Loot", cost: 14, icon: "lock", desc: "Bank your haul so death can't claw it back." },
    { id: "second-wind", label: "Second Wind", cost: 30, icon: "heart-plus", desc: "Hold a revive — survive your next death at half HP.", once: true },
];

export const HOLLOW_SHARD_WARD_STEPS = 6;

const byId = new Map(HOLLOW_SHARD_CONSUMABLES.map((c) => [c.id, c]));

export type ShardUseResult =
    | { ok: true; run: HollowGateShrineRun; character: Character; log: string }
    | { ok: false; reason: string };

/** Is this consumable currently available (affordable + not already active)? */
export function shardConsumableAvailable(c: HollowShardConsumable, run: HollowGateShrineRun, character: Character): boolean {
    if ((character.hollowShards ?? 0) < c.cost) return false;
    if (c.id === "diviner-eye" && run.diviner) return false;
    if (c.id === "second-wind" && run.secondWindArmed) return false;
    if (c.id === "reignite" && run.torch >= 10) return false;
    return true;
}

/** Spend shards and apply a consumable's effect. Pure — returns new run+character. */
export function applyShardConsumable(id: string, run: HollowGateShrineRun, character: Character): ShardUseResult {
    const c = byId.get(id);
    if (!c) return { ok: false, reason: "Unknown shrine relic." };
    if (!shardConsumableAvailable(c, run, character)) return { ok: false, reason: "Not enough Hollow Shards, or already active." };

    const character2: Character = { ...character, hollowShards: (character.hollowShards ?? 0) - c.cost };
    let run2: HollowGateShrineRun;
    let log: string;
    switch (id) {
        case "reignite":
            run2 = { ...run, torch: 10 };
            log = "You crush a shard against the Torch of Reiki — it flares back to full.";
            break;
        case "skeleton-key":
            run2 = { ...run, keys: run.keys + 1 };
            log = "Shards fuse into a Skeleton Key in your palm. +1 Shrine Key.";
            break;
        case "hollow-ward":
            run2 = { ...run, threat: 0, wardSteps: HOLLOW_SHARD_WARD_STEPS };
            log = `A Hollow Ward settles over you — Threat dissipates and stays still for ${HOLLOW_SHARD_WARD_STEPS} steps.`;
            break;
        case "diviner-eye":
            run2 = { ...run, diviner: true, tiles: run.tiles.map((t) => ({ ...t, revealed: true })) };
            log = "The Diviner's Eye opens — the whole floor burns into your mind.";
            break;
        case "sanctify":
            // Re-snapshot entry currencies to NOW, so the death claw-back treats
            // everything earned so far as already secured.
            run2 = { ...run, entryCurrencies: snapshotHollowGateCurrencies(character2) };
            log = "You sanctify your haul — what you've earned is safe from the dark.";
            break;
        case "second-wind":
            run2 = { ...run, secondWindArmed: true };
            log = "You bind a Second Wind — the next death will not be the end.";
            break;
        default:
            return { ok: false, reason: "Unknown shrine relic." };
    }
    return { ok: true, run: run2, character: character2, log };
}

/**
 * Death-time Second Wind. If a charge is armed, consume it and revive at half
 * HP with Threat cleared; returns null if no charge (caller proceeds with the
 * normal death). Pure.
 */
export function tryHollowGateSecondWind(
    run: HollowGateShrineRun,
    character: Character,
): { run: HollowGateShrineRun; character: Character; log: string } | null {
    if (!run.secondWindArmed) return null;
    return {
        run: { ...run, secondWindArmed: false, threat: 0 },
        character: { ...character, hospitalized: false, hp: Math.max(1, Math.floor(character.maxHp * 0.5)) },
        log: "Your Second Wind ignites — you are torn back from death at half strength.",
    };
}
