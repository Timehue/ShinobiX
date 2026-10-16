import { STARTER_EVOLUTIONS, petVisualId } from "../data/pet-evolutions";
import { versionPetArtUrl } from "./pet-art-revision";
import { petScenicPortraitImage } from "./pet-scenic-portrait";
import { petStripVariant } from "./pet-presentation-keys";
import type { Pet } from "../types/pet";

// Legacy source-art fallback for the ten starter evolution templates.
const EVO_TEMPLATE_IDS: ReadonlySet<string> = new Set(STARTER_EVOLUTIONS.map((pet) => pet.id));

export function evoTemplateArt(id: string): string {
    return EVO_TEMPLATE_IDS.has(id) ? versionPetArtUrl(`/pet-evos/${id}.webp`) : "";
}

function portraitTemplateId(pet: Pet): string {
    const templateId = pet.templateId?.trim() || petStripVariant(pet.id.split(':', 1)[0]);
    return petVisualId({ ...pet, templateId });
}

/** The admin preview follows the same portrait as players, with a fresh local edit first. */
export function adminPetPortraitImage(pet: Pet, pinned: Record<string, string>, shared: Record<string, string>): string {
    return pinned[`pet:${pet.id}`] || pinned[`petcard:${portraitTemplateId(pet)}`]
        || petScenicPortraitImage(pet, shared);
}

/** Keep the existing photo slot while publishing the explicit static-card override. */
export async function publishAdminPetPortrait(pet: Pet, image: string, publish: (id: string, image: string) => Promise<boolean>, updateLocal?: (images: Record<string, string>) => void): Promise<boolean> {
    if (!image) return false;
    const slots = { [`pet:${pet.id}`]: image, [`petcard:${portraitTemplateId(pet)}`]: image };
    updateLocal?.(slots);
    const results = await Promise.all(Object.entries(slots).map(([id, source]) => publish(id, source)));
    return results.every(Boolean);
}
