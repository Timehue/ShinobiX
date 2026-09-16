import type { Pet } from "../types/pet";
import type { CreatorEvent } from "../types/vn";

/** Bind the reusable encounter scene to the animal actually discovered. */
export function buildPetEncounterVn(
    template: CreatorEvent,
    pet: Pick<Pet, "name">,
    petImage: string,
): CreatorEvent {
    const pages: NonNullable<CreatorEvent["vnPages"]> = template.vnPages?.length
        ? template.vnPages
        : [{
            title: template.vnTitle || template.name,
            scene: template.vnScene || "Fresh tracks stop beside your own.",
            speaker: template.vnSpeaker || "Narrator",
            dialogue: template.dialogue,
        }];

    return {
        ...template,
        id: "sys-pet-encounter",
        biome: "forest",
        avatarImage: petImage,
        vnPages: pages.map((page) => ({
            ...page,
            // Published templates may still carry a narrator portrait or a
            // previous animal's name. The encounter owns both actor slots;
            // narration, scenery, direction and choices remain authored.
            leftName: "Player",
            leftImage: undefined,
            rightName: pet.name,
            rightImage: petImage || undefined,
        })),
    };
}
