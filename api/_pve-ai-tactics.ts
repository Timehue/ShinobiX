/*
 * Server mirror of the PvE combat-AI perception layer —
 * `shinobij.client/src/lib/combat-ai-tactics.ts`.
 *
 * PARTIAL BY DESIGN. Solo PvE now has a deterministic smart scorer and executes
 * validated authored rule programs server-side. The only client perception
 * constant mirrored here is the "is this buff worth a 60-AP Clear" list that
 * feeds `pveAiCompetence().clearBuffThreshold`.
 *
 * Why the rest is NOT needed to match the client's behaviour:
 *   • `PlayerRead.justPoweredUp` (the only field the competence gate reads) is
 *     applied as `readsBehavior && justPoweredUp ? 1 : clearBuffThreshold`.
 *     `readsBehavior` is true only in the hard and peer bands, and BOTH of those
 *     already carry `clearBuffThreshold: 1` — so that ternary can never change
 *     the threshold. The action memory is inert for this decision on the client
 *     too, and porting it would add state that changes nothing.
 *   • `usesSmartScorer` is consumed directly by the Solo PvE engine, including
 *     the profile's server-sealed `masterAi` flag. This module does not duplicate
 *     that scorer; it owns only the shared meaningful-buff vocabulary.
 *
 * Source of truth is the client file. `scripts/pve-ai-tactics-parity.test.ts`
 * fails if the two lists drift.
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
