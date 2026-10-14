import { memo } from "react";
import { petDisplayName } from "../lib/pet";
import type { Pet } from "../types/pet";
import { PetArtwork } from "./PetArtwork";

/** The same portrait and identity hierarchy in every Companion Home surface.
 *  Memoized: it renders only from its props, and callers pass a pet from
 *  `character.pets` (kept by reference across idle-regen ticks) plus the shared
 *  image map, so grids of these skip the parent's every-second re-render. */
export const CompanionIdentity = memo(function CompanionIdentity({ pet, sharedImages, compact = false, loading }: {
    pet: Pet;
    sharedImages: Record<string, string>;
    compact?: boolean;
    loading?: "eager" | "lazy";
}) {
    const name = petDisplayName(pet);
    return <span className={`companion-identity${compact ? " companion-identity--compact" : ""}`}>
        <span className="companion-identity-art"><PetArtwork pet={pet} sharedImages={sharedImages} fallbackClassName="companion-identity-fallback" loading={loading} /></span>
        <span className="companion-identity-copy">
            <span className="companion-identity-name" title={name} role={compact ? undefined : "heading"} aria-level={compact ? undefined : 3}>{name}</span>
            <span className="companion-identity-meta">
                <span className="companion-identity-rarity">{pet.rarity}</span>
                <span>Lv {pet.level}</span>
                <span>{pet.element && pet.element !== "None" ? pet.element : "Neutral"}</span>
            </span>
        </span>
    </span>;
});
