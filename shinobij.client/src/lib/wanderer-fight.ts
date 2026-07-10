// Client-side handoff for wanderer/ambush fights.
//
// WorldMap's launchWandererArenaFight() stores a pending record before sending the
// player into the Arena; the Arena stamps the AUTHORITATIVE outcome when the fight
// finalizes; WorldMap reads it back to resolve the encounter and continue any ambush
// chain.
//
// The outcome is stamped here rather than inferred on the map from a totalAiKills
// delta, because that kill count syncs asynchronously (and can be clobbered by a
// save-conflict refetch). Inferring from it made real ambush WINS resolve as losses.
export const WANDERER_PENDING_KEY = "wandererFight.pending.v1";

export type WandererFightResult = "win" | "loss" | "fled";

/**
 * Stamp the authoritative battle outcome onto the pending wanderer-fight record, if
 * one exists. No-op for every non-wanderer battle (there is no pending record) and in
 * private-browsing mode (localStorage throws). Called from the Arena when a battle
 * finalizes.
 */
export function stampWandererFightResult(result: WandererFightResult): void {
    try {
        const raw = localStorage.getItem(WANDERER_PENDING_KEY);
        if (!raw) return;
        const rec = JSON.parse(raw) as Record<string, unknown>;
        rec.result = result;
        localStorage.setItem(WANDERER_PENDING_KEY, JSON.stringify(rec));
    } catch { /* private mode / bad JSON — the map falls back to the totalAiKills delta */ }
}
