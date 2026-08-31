import { lazy, Suspense, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { Wanderer } from "./wanderers";
import {
    PET_MENTOR_WANDERER_ID,
    petMentorWandererFor,
} from "./pet-tutorial-mentor";
import type { PetTutorialProgress } from "../../../shared/pet-tutorial";
import tomoePortrait from "../assets/pet-mentor/tomoe-portrait.webp";
import tomoeKuroKeyArt from "../assets/pet-mentor/tomoe-kuro-key-art.webp";

const loadPetMentorGuide = () => import("../components/PetMentorGuide");
const preloadPetMentorGuide = () => { void loadPetMentorGuide().catch(() => undefined); };

type UsePetMentorGuideArgs = {
    character: Character;
    selectedSector: number | null;
    updateCharacter: Dispatch<SetStateAction<Character | null>>;
    setScreen: (screen: Screen) => void;
};

/**
 * Presentation-only controller for Tomoe's World Map visit. Keeping this leaf
 * separate prevents tutorial state and lazy UI code from enlarging WorldMap's
 * already-sensitive authority surface.
 */
export function usePetMentorGuide({
    character,
    selectedSector,
    updateCharacter,
    setScreen,
}: UsePetMentorGuideArgs) {
    const [open, setOpen] = useState(false);
    const [PetMentorGuide] = useState(() => lazy(() => loadPetMentorGuide().then((module) => ({ default: module.PetMentorGuide }))));
    const wanderers = useMemo(
        () => petMentorWandererFor({
            level: character.level,
            pets: character.pets,
            petTutorialProgress: character.petTutorialProgress,
        }, selectedSector).map((wanderer) => ({ ...wanderer, avatarImage: tomoePortrait })),
        [character.level, character.pets, character.petTutorialProgress, selectedSector],
    );
    const mentor = wanderers[0] ?? null;

    function recordProgress(progress: PetTutorialProgress) {
        updateCharacter((current) => current ? { ...current, petTutorialProgress: progress } : current);
    }

    function engage(wanderer: Wanderer): boolean {
        if (wanderer.id !== PET_MENTOR_WANDERER_ID) return false;
        setOpen(true);
        return true;
    }

    const guide = open ? (
        <Suspense fallback={null}>
            <PetMentorGuide
                open
                character={character}
                onClose={() => setOpen(false)}
                onProgress={recordProgress}
                setScreen={setScreen}
            />
        </Suspense>
    ) : null;

    const roadPrompt = mentor ? (
        <button
            type="button"
            className="pet-mentor-road-prompt"
            onClick={() => setOpen(true)}
            onPointerEnter={preloadPetMentorGuide}
            onFocus={preloadPetMentorGuide}
        >
            <span className="pet-mentor-road-art" aria-hidden="true"><img src={tomoeKuroKeyArt} alt="" /></span>
            <span>
                <small>Field lesson ready</small>
                <strong>Tamer Tomoe &amp; Kuro</strong>
                <em>{mentor.greeting}</em>
            </span>
            <b>Study →</b>
        </button>
    ) : null;

    return { wanderers, engage, guide, roadPrompt } as const;
}
