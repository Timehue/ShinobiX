import type { Pet } from "../types/pet";
import { CHROMATIC_PET_SURFACE, type PetModelSurfaceTreatment } from "./pet-model-surface";

export function petPaletteVariant(pet: Pick<Pet, "paletteVariantId">): string | null {
    const value = typeof pet.paletteVariantId === "string" ? pet.paletteVariantId.trim().toLowerCase() : "";
    return value || null;
}

export function petVisualVariantClass(pet: Pick<Pet, "paletteVariantId">): string {
    return petPaletteVariant(pet) ? "pet-visual--chromatic" : "";
}

export function petModelVariantSurface(
    pet: Pick<Pet, "paletteVariantId">,
    fallback?: PetModelSurfaceTreatment,
): PetModelSurfaceTreatment | undefined {
    return petPaletteVariant(pet) ? CHROMATIC_PET_SURFACE : fallback;
}

export function variantImageKeys(prefix: string, pet: Pick<Pet, "paletteVariantId">, ids: readonly string[]): string[] {
    const variant = petPaletteVariant(pet);
    if (!variant) return ids.map((id) => `${prefix}${id}`);
    return [
        ...ids.map((id) => `${prefix}${id}:variant:${variant}`),
        ...ids.map((id) => `${prefix}${id}`),
    ];
}

export function firstSharedImage(sharedImages: Record<string, string>, keys: readonly string[]): string {
    for (const key of keys) {
        const value = sharedImages[key];
        if (value) return value;
    }
    return "";
}
