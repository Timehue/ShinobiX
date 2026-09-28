import type { Screen } from "../types/core";
import type { Character } from "../types/character";
import type { CreatorEvent } from "../types/vn";
import { AWAKENING_VN_ID } from "../constants/game";
import { awakeningLv2VnEvent } from "../data/vn-events";
import { canonicalNarrativeEvent, isReservedNarrativeId } from "./canonical-narrative";
import { getCharacterElements } from "./elements";
import { normalizeOnboardingStep } from "./onboarding-step";

/**
 * The visual novel a navigation should open instead of arriving, if any.
 *
 * Moved verbatim out of App's navigate(). `id` is what joins triggeredEvents,
 * which for the built-in Awakening Stone is AWAKENING_VN_ID whatever the
 * creator-edited copy calls itself.
 */
export function departureNarrative({ character, screen, nextScreen, triggeredEvents, creatorEvents }: {
    character: Character | null | undefined;
    screen: Screen;
    nextScreen: Screen;
    triggeredEvents: readonly string[];
    creatorEvents: readonly CreatorEvent[];
}): { id: string; event: CreatorEvent } | null {
    const routeCharacter = character;
    const leavingVillage = screen === "village" && nextScreen !== "village";
    const openingUnawakenedCentralHub = nextScreen === "centralHub"
        && !!routeCharacter
        && getCharacterElements(routeCharacter).length === 0;
    if (routeCharacter && (leavingVillage || openingUnawakenedCentralHub) && normalizeOnboardingStep(routeCharacter.onboardingStep) === "done") {
        // Built-in: introduce awakening before the first post-Academy trip
        // to Central Hub, or on the legacy first departure from the village.
        if (routeCharacter.level >= 2 && !triggeredEvents.includes(AWAKENING_VN_ID)) {
            return { id: AWAKENING_VN_ID, event: canonicalNarrativeEvent(awakeningLv2VnEvent, creatorEvents.find(e => e.id === AWAKENING_VN_ID)) };
        }

        const event = leavingVillage ? creatorEvents.find(
            (candidate) =>
                candidate.eventKind === "visualNovel" &&
                !isReservedNarrativeId(candidate.id) &&
                candidate.trigger === "firstLeaveVillage" &&
                !triggeredEvents.includes(candidate.id) &&
                routeCharacter.level >= candidate.levelReq
        ) : undefined;

        if (event) return { id: event.id, event };
    }
    return null;
}
