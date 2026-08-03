/*
 * Server mirror of the PvE combat-AI perception layer —
 * `shinobij.client/src/lib/combat-ai-tactics.ts`.
 *
 * PARTIAL BY DESIGN. The client module's `buildPlayerRead()` condenses the
 * player's state PLUS a rolling memory of their recent actions. The server
 * engine keeps no per-actor action history, so only the piece the server AI
 * actually consumes is mirrored here: the "is this buff worth a 60-AP Clear"
 * list that feeds `pveAiCompetence().clearBuffThreshold`.
 *
 * Why the rest is NOT needed to match the client's behaviour:
 *   • `PlayerRead.justPoweredUp` (the only field the competence gate reads) is
 *     applied as `readsBehavior && justPoweredUp ? 1 : clearBuffThreshold`.
 *     `readsBehavior` is true only in the hard and peer bands, and BOTH of those
 *     already carry `clearBuffThreshold: 1` — so that ternary can never change
 *     the threshold. The action memory is inert for this decision on the client
 *     too, and porting it would add state that changes nothing.
 *   • `usesSmartScorer` gates the client's multi-factor jutsu scorer. The tower
 *     engine has a single deterministic policy (highest effectPower, id
 *     tie-break) and no second scorer to switch to, so there is nothing to gate.
 *     That is also why the server never needs the profile's `masterAi` flag —
 *     it is the only input `usesSmartScorer` depends on.
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
