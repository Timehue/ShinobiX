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
    if (isStory && goal > 0) {
        return {
            debriefLabel: "Rounds / par",
            debriefValue: `${session.round} / ${hardLimit} · Par ${goal}`,
            hudLabel: `Round ${session.round}/${hardLimit} · Par ${goal}`,
            hudTitle: `Par ${goal} affects clear score only. Clear by the end of round ${hardLimit} or the floor fails.`,
            hardLimit,
        };
    }

    if (hardLimit > 0) {
        return {
            debriefLabel: "Round limit",
            debriefValue: `${session.round} / ${hardLimit}`,
            hudLabel: `Round ${session.round}/${hardLimit} · limit`,
            hudTitle: `The encounter ends after round ${hardLimit}.`,
            hardLimit,
        };
    }

    return {
        debriefLabel: "Rounds",
        debriefValue: String(session.round),
        hudLabel: `Round ${session.round}`,
        hudTitle: `Current round ${session.round}.`,
        hardLimit: null,
    };
}

