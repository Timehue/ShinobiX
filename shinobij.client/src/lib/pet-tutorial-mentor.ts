import type { Character } from "../types/character";
import {
    PET_TUTORIAL_UNLOCKS,
    normalizePetTutorialProgress,
} from "../../../shared/pet-tutorial";
import type { Wanderer } from "./wanderers";

export const PET_MENTOR_WANDERER_ID = "pet-mentor-tomoe";
export const PET_MENTOR_NAME = "Tamer Tomoe";

export function petMentorWandererFor(
    character: Pick<Character, "level" | "pets" | "petTutorialProgress">,
    sector: number | null,
): Wanderer[] {
    const completed = new Set(normalizePetTutorialProgress(character.petTutorialProgress).completedLessonIds);
    const lesson = PET_TUTORIAL_UNLOCKS.find((entry) => (
        character.level >= entry.minLevel
        && character.pets.length >= entry.minPets
        && !completed.has(entry.id)
    ));
    if (sector == null || !lesson) return [];
    const order = PET_TUTORIAL_UNLOCKS.findIndex((entry) => entry.id === lesson.id) + 1;
    const home = 4 * 12 + ((sector * 11 + order * 5) % 8) + 2;
    const greeting = lesson.id === "bond"
        ? "Kuro found your trail. His second tail only stirs for a bond worth studying—come learn why."
        : `Kuro found your trail. You're ready for ${lesson.shortTitle.toLowerCase()} — if you're willing to learn it properly.`;
    return [{
        id: PET_MENTOR_WANDERER_ID,
        name: PET_MENTOR_NAME,
        archetype: "tracker",
        verb: "quest",
        level: Math.max(15, lesson.minLevel),
        homeTile: home,
        waypoints: [home, home + 1, home + 12, home - 1],
        greeting,
        tellTint: "#f4b860",
        avatarKey: "tracker",
    }];
}
