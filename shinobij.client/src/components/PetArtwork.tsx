import { useState } from "react";
import { petPoseImage } from "../lib/pet-battle-anim";
import { petScenicPortraitImage as petCardImage } from "../lib/pet-scenic-portrait";
import type { Pet } from "../types/pet";

function ArtworkSource({ pet, sources, alt, className, fallbackClassName, loading }: {
    pet: Pet;
    sources: string[];
    alt: string;
    className?: string;
    fallbackClassName?: string;
    loading: "eager" | "lazy";
}) {
    const [sourceIndex, setSourceIndex] = useState(0);
    const source = sources[sourceIndex];
    // `pet-art-scenic` lets wrappers use `:has(img.pet-art-scenic)`: an attribute
    // selector inside `:has()` made Chrome re-check every page-level `:has()`.
    const scenic = Boolean(source?.includes('/pet-portraits/shinobi-v1/'));
    return source
        ? <img className={[className, scenic && 'pet-art-scenic'].filter(Boolean).join(' ') || undefined} src={source} alt={alt} loading={loading} data-pet-art={scenic ? 'scenic' : undefined} onError={() => setSourceIndex((index) => index + 1)} />
        : <span className={fallbackClassName} role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>{pet.name.slice(0, 2).toUpperCase()}</span>;
}

/** Shared pet art resolution for roster cards and their selected-pet panels. */
export function PetArtwork({ pet, sharedImages, alt = "", className, fallbackClassName, loading = "lazy" }: {
    pet: Pet;
    sharedImages: Record<string, string>;
    alt?: string;
    className?: string;
    fallbackClassName?: string;
    loading?: "eager" | "lazy";
}) {
    const sources = [...new Set([petCardImage(pet, sharedImages), petPoseImage(pet, sharedImages)].filter(Boolean))];
    return <ArtworkSource key={`${pet.id}:${sources.join("|")}`} pet={pet} sources={sources} alt={alt} className={className} fallbackClassName={fallbackClassName} loading={loading} />;
}
