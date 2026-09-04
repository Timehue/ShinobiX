import { WARFRONT_PET_LOD_MANIFEST } from "../generated/pet-warfront-lod-manifest";
import type { PetCombatModelConfig } from "./pet-3d-models";

export type WarfrontPetLodEntry = {
    lodUrl: string;
    sourceTriangles: number;
    lodTriangles: number;
};

/** Query strings revision the source cache but are not part of asset identity. */
export function warfrontPetModelSourceUrl(url: string): string {
    return url.split("?", 1)[0];
}

export function warfrontPetLodEntry(url: string): WarfrontPetLodEntry | null {
    const sourceUrl = warfrontPetModelSourceUrl(url);
    return (WARFRONT_PET_LOD_MANIFEST as Readonly<Record<string, WarfrontPetLodEntry>>)[sourceUrl] ?? null;
}

/** `ritelod=0` is an explicit local visual-A/B hook; shipped Warfront always
 * chooses the certified offline LOD. Missing manifest entries safely retain
 * the authored source asset instead of producing an invisible fighter. */
export function warfrontPetLodEnabled(search = typeof window === "undefined" ? "" : window.location.search): boolean {
    return new URLSearchParams(search).get("ritelod") !== "0";
}

export function warfrontPetModelConfig(
    source: PetCombatModelConfig | null,
    enabled = warfrontPetLodEnabled(),
): PetCombatModelConfig | null {
    if (!source || !enabled) return source;
    const lod = warfrontPetLodEntry(source.url);
    return lod ? { ...source, url: lod.lodUrl } : source;
}
