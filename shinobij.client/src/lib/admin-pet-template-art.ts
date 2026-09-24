import { STARTER_EVOLUTIONS } from "../data/pet-evolutions";
import { versionPetArtUrl } from "./pet-art-revision";

// Starter evolution portraits are bundled files rather than shared `pet:` art.
// The admin avatar grid uses them only for those ten template ids.
const EVO_TEMPLATE_IDS: ReadonlySet<string> = new Set(STARTER_EVOLUTIONS.map((pet) => pet.id));

export function evoTemplateArt(id: string): string {
    return EVO_TEMPLATE_IDS.has(id) ? versionPetArtUrl(`/pet-evos/${id}.webp`) : "";
}
