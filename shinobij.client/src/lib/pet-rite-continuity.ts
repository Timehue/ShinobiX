/*
 * Beastbound Warfront — how a match moves from one clash to the next.
 *
 * These are the decisions the Rite makes between clashes, lifted out of the
 * component so every interlude runs the SAME policy:
 *
 *   - `riteHeldFormation`       the line a band just fought. Holding it needs no
 *                               new simulation, so it is always available.
 *   - `lockRiteReform`          records one locked re-form in the plan exactly
 *                               as the re-form panel always has.
 *   - `automaticRiteReformChoice` what a seat that takes no decisions (a
 *                               spectator or a sealed replay) locks.
 *
 * Nothing here changes the simulation, the seed or the plan contract: a plan
 * built here is byte-for-byte the plan the panel built before, and it is still
 * the server's replay of that plan that decides a rewarded match.
 */
import {
    WARFRONT_DEFAULT_DEPLOYMENT,
    deterministicRiteCounterMove,
    type RiteClash,
    type RitePlan,
} from "./pet-warfront-rite";

export type RiteFormationChoice = { formation: number[]; deployment: number[] };

/** The formation and cells the blue band fought `clash` with. */
export function riteHeldFormation(clash: RiteClash, plan: RitePlan | null, bandSize: number): RiteFormationChoice {
    return {
        formation: [...clash.blue].sort((a, b) => a.lane - b.lane).map((combatant) => combatant.slot),
        deployment: Array.from({ length: bandSize }, (_, slot) =>
            clash.blue.find((combatant) => combatant.slot === slot)?.node
                ?? plan?.deployment?.[slot]
                ?? WARFRONT_DEFAULT_DEPLOYMENT[slot],
        ),
    };
}

/**
 * Lock `choice` after clash `clashIndex`. A changed layout is appended to the
 * ordered re-form transcript (the first one also fills the legacy single-reform
 * fields old receipts read); an unchanged one returns the plan untouched,
 * because holding the line is not a command and needs no new simulation.
 */
export function lockRiteReform(
    plan: RitePlan,
    clash: RiteClash,
    clashIndex: number,
    bandSize: number,
    choice: RiteFormationChoice,
): { changed: boolean; plan: RitePlan } {
    const previousDeployment = Array.from({ length: bandSize }, (_, slot) =>
        clash.blue.find((combatant) => combatant.slot === slot)?.node ?? (plan.deployment?.[slot] ?? WARFRONT_DEFAULT_DEPLOYMENT[slot]),
    );
    const changed = choice.deployment.some((node, slot) => node !== previousDeployment[slot]);
    if (!changed) return { changed, plan };
    const nextReform = {
        afterClash: clashIndex,
        formation: [...choice.formation],
        deployment: [...choice.deployment],
    };
    const reforms = [...(plan.reforms ?? [])]
        .filter((entry) => entry.afterClash !== clashIndex)
        .concat(nextReform)
        .sort((a, b) => a.afterClash - b.afterClash);
    const hasLegacyReform = plan.reformAfterClash !== null && plan.reformAfterClash !== undefined;
    return {
        changed,
        plan: {
            ...plan,
            reforms,
            reformAfterClash: hasLegacyReform ? plan.reformAfterClash : clashIndex,
            reform: hasLegacyReform ? plan.reform : [...choice.formation],
            reformDeployment: hasLegacyReform ? plan.reformDeployment : [...choice.deployment],
        },
    };
}

/** A seat that takes no decisions answers a lost clash with the public,
 * deterministic counter-move and otherwise holds. A sealed replay already
 * carries every recorded re-form in its plan, so it always holds here. */
export function automaticRiteReformChoice(clash: RiteClash, held: RiteFormationChoice, sealed: boolean): RiteFormationChoice {
    const counter = sealed ? null : deterministicRiteCounterMove(clash, "blue");
    return counter ? { formation: counter.formation, deployment: counter.deployment } : held;
}
