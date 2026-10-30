import { COMBAT_MAX_ROUNDS } from "../../../shared/combat-limits";
import type { TowerSession } from "./towers-api";

type TowerRoundPresentation = {
    debriefLabel: string;
    debriefValue: string;
    hudLabel: string;
    hudTitle: string;
    hardLimit: number | null;
};

/**
 * Keep Story score pace, timed objectives, and true hard limits visually distinct.
 * Story `roundBudget` is a par used for score pacing; only protect/survive objectives
 * and sealed Spire/embedded `roundCap` values are deadlines. All fights also have
 * the engine safety deadline.
 */
export function towerRoundPresentation(session: TowerSession): TowerRoundPresentation {
    const round = session.round;
    const hardLimit = Math.min(COMBAT_MAX_ROUNDS, Number(session.roundCap ?? COMBAT_MAX_ROUNDS));
    const objective = session.objectiveState.kind;
    const goal = Number((session.sealedCatalogFloor ?? session.encounterFloor)?.roundBudget ?? 0);
    const isTimedHold = objective === "protect-npc" || objective === "survive";
    if (isTimedHold) {
        const held = Math.max(0, Number(session.objectiveState.roundsSurvived ?? 0));
        return {
            debriefLabel: "Hold duration",
            debriefValue: goal > 0 ? `${held} / ${goal} rounds` : `${held} rounds`,
            hudLabel: goal > 0 ? `Hold ${held}/${goal}` : `Held ${held} rounds`,
            hudTitle: goal > 0 ? `Hold the objective for ${goal} completed rounds.` : "Completed objective-hold rounds.",
            hardLimit: goal > 0 ? goal : null,
        };
    }

    const isStory = session.towerId === "celestial"
        && Number(session.ascensionTier ?? 0) === 0
        && session.floor >= 1 && session.floor <= 15;
    const parSuffix = isStory && goal > 0 ? ` · Par ${goal}` : "";
    if (parSuffix || hardLimit > 0) {
        return {
            debriefLabel: parSuffix ? "Rounds / par" : "Round limit",
            debriefValue: `${round} / ${hardLimit}${parSuffix}`,
            hudLabel: `Round ${round}/${hardLimit}${parSuffix || " · limit"}`,
            hudTitle: parSuffix
                ? `Par ${goal} affects clear score only. Clear by the end of round ${hardLimit} or the floor fails.`
                : `The encounter ends after round ${hardLimit}.`,
            hardLimit,
        };
    }

    return {
        debriefLabel: "Rounds",
        debriefValue: String(round),
        hudLabel: `Round ${round}`,
        hudTitle: `Current round ${round}.`,
        hardLimit: null,
    };
}

