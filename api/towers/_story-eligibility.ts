import { hasClearedTowerFloor, type TowerEntryCharacter } from './_entry-fee.js';

export const STORY_TOWER_MIN_LEVEL = 30;

export type StoryTowerEligibility = {
    eligible: boolean;
    replay: boolean;
    requiredLevel?: number;
    requiredFloor?: number;
};

export type StoryTowerMemberRequirement = {
    member: string;
    requiredLevel?: number;
    requiredFloor?: number;
};

function whole(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

/**
 * A Story floor is enterable only at level 30+, and only when it is either an
 * authoritative clear replay or the next sequential floor. `requiredFloor`
 * intentionally names the requested floor so clients can say "clear through
 * floor N-1 first" without receiving a private progression snapshot.
 */
export function storyTowerEligibility(
    character: TowerEntryCharacter,
    requestedFloor: number,
): StoryTowerEligibility {
    const floor = whole(requestedFloor);
    const replay = hasClearedTowerFloor(character, floor);
    const bestFloor = whole(character.battleTowerBestFloor);
    const requiredLevel = whole(character.level) < STORY_TOWER_MIN_LEVEL
        ? STORY_TOWER_MIN_LEVEL
        : undefined;
    const requiredFloor = !replay && floor > bestFloor + 1
        ? floor
        : undefined;
    return {
        eligible: requiredLevel === undefined && requiredFloor === undefined,
        replay,
        ...(requiredLevel === undefined ? {} : { requiredLevel }),
        ...(requiredFloor === undefined ? {} : { requiredFloor }),
    };
}

/** Evaluate exactly the live authoritative members selected by the caller. */
export function storyTowerMemberRequirements(
    members: readonly { member: string; character: TowerEntryCharacter }[],
    requestedFloor: number,
): StoryTowerMemberRequirement[] {
    return members.flatMap(({ member, character }) => {
        const eligibility = storyTowerEligibility(character, requestedFloor);
        return eligibility.eligible
            ? []
            : [{
                member,
                ...(eligibility.requiredLevel === undefined ? {} : { requiredLevel: eligibility.requiredLevel }),
                ...(eligibility.requiredFloor === undefined ? {} : { requiredFloor: eligibility.requiredFloor }),
            }];
    });
}
