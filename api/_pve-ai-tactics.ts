/*
 * PvE combat-AI perception: the "is this buff worth a 60-AP Clear" vocabulary
 * that feeds `pveAiCompetence().clearBuffThreshold`.
 *
 * This began as a partial mirror of the client's perception layer
 * (lib/combat-ai-tactics.ts). Solo PvE now runs a deterministic smart scorer and
 * validated authored rule programs server-side, and nothing in the client
 * imported that file any more, so it was deleted. Only this list ever needed to
 * exist server-side:
 *   • `PlayerRead.justPoweredUp` (the only other field the competence gate read)
 *     was applied as `readsBehavior && justPoweredUp ? 1 : clearBuffThreshold`.
 *     `readsBehavior` is true only in the hard and peer bands, and BOTH of those
 *     already carry `clearBuffThreshold: 1` — so that ternary could never change
 *     the threshold, and the action memory behind it was inert for this decision.
 *   • `usesSmartScorer` is consumed directly by the Solo PvE engine, including
 *     the profile's server-sealed `masterAi` flag.
 *
 * The list is pinned by api/_pve-ai-tactics.test.ts. Changing it is a balance
 * change.
 */

/** Buffs the AI considers worth spending a 60-AP Clear on. Trivial / cosmetic
 *  positives are excluded so a single throwaway buff doesn't bait a wasted turn. */
export const PVE_MEANINGFUL_BUFFS: ReadonlySet<string> = new Set<string>([
    'Increase Damage Given',
    'Increase Generals',
    'Increase Discipline',
    'Decrease Damage Taken',
    'Absorb',
    'Reflect',
    'Lifesteal',
    'Increase Heal',
    'Overclock',
    'Debuff Prevent',
    'Stun Prevent',
    'Clear Prevent',
]);

/** How many of `statuses` are positives worth clearing. Callers pass the
 *  ALREADY round-filtered (active) list, mirroring the client's
 *  `activeStatuses(playerStatuses)` argument. */
export function pveMeaningfulBuffCount(
    statuses: ReadonlyArray<{ name?: unknown; kind?: unknown }>,
): number {
    let n = 0;
    for (const s of statuses) {
        if (s && s.kind === 'positive' && typeof s.name === 'string' && PVE_MEANINGFUL_BUFFS.has(s.name)) n++;
    }
    return n;
}
