import { biomeForWorldSector, worldSectorOptions } from "../data/sectors";
import type { CreatorMission } from "../types/missions";

export function huntRequiredTracks(mission: Pick<CreatorMission, "exploreCount">): number {
    return Math.max(1, Math.floor(Number(mission.exploreCount) || 1));
}
export function huntReadyForFight(mission: Pick<CreatorMission, "exploreCount">, progress: number): boolean {
    return Math.max(0, Math.floor(progress)) >= huntRequiredTracks(mission) - 1;
}

function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function cleanSector(sector: number): number {
    const n = Math.max(1, Math.min(60, Math.floor(Number(sector) || 1)));
    return n;
}

function trailCandidates(targetSector: number): number[] {
    const target = cleanSector(targetSector);
    const biome = biomeForWorldSector(target);
    const sameBiome = worldSectorOptions
        .filter((sector) => sector >= 1 && sector <= 60 && sector !== 35)
        .filter((sector) => sector !== target && biomeForWorldSector(sector) === biome)
        .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    return sameBiome.length > 0 ? sameBiome : [target];
}

export function huntTrailSector(
    mission: Pick<CreatorMission, "id" | "targetSector" | "exploreCount">,
    progress: number,
    hunterName = "",
): number {
    const target = cleanSector(mission.targetSector);
    const requiredTracks = huntRequiredTracks(mission);
    const stage = Math.max(0, Math.min(requiredTracks - 1, Math.floor(progress)));

    if (stage === 0 || stage >= requiredTracks - 1) return target;

    const candidates = trailCandidates(target);
    const seed = hashString(`${mission.id}:${hunterName.toLowerCase()}:${stage}:${target}`);
    return candidates[seed % candidates.length] ?? target;
}
