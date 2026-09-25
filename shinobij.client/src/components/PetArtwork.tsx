import { useState } from "react";
import { petCardImage, petPoseImage } from "../lib/pet-battle-anim";
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
    return source
        ? <img className={className} src={source} alt={alt} loading={loading} onError={() => setSourceIndex((index) => index + 1)} />
        : <span className={fallbackClassName} role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>{pet.name.slice(0, 2).toUpperCase()}</span>;
}

/** Shared pet art resolution for roster cards and their selected-pet panels. */
export function PetArtwork({ pet, sharedImages, alt = "", className, fallbackClassName, loading = "eager" }: {
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
