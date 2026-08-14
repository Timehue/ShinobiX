import { biomeForWorldSector, worldSectorOptions } from "../data/sectors";
import { isWildSector, FESTIVAL_SECTOR } from "../../../shared/sector-geo";
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
        // Skip the festival sector — it is an event stage, not huntable ground.
        // (This used to read `!== 35`, the festival's PRE-renumbering id, which
        // has meant "Glacier Bridge" since the 2026-07 reorg.)
        // Authored hunt leads intentionally stay on the original 1..60 contract
        // ground even though general World encounters also accept sectors 61..66.
        .filter((sector) => sector <= 60 && isWildSector(sector) && sector !== FESTIVAL_SECTOR)
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

    // Only the FINAL stage is the beast's ground. Earlier stages used to include
    // stage 0, which made the trail run target -> elsewhere -> target: the player
    // started on the destination, got yanked away to a hashed sector, then pulled
    // back. It read as arbitrary teleporting rather than a hunt.
    if (stage >= requiredTracks - 1) return target;

    // Walk the trail INWARD. `trailCandidates` is sorted nearest-first, so band 0
    // is the closest ring and the last band the farthest. Stage 0 draws from the
    // farthest band and each track closes one band, so the sign genuinely leads
    // toward the target instead of bouncing around the biome.
    const candidates = trailCandidates(target);
    const approachStages = Math.max(1, requiredTracks - 1);
    const bandSize = Math.max(1, Math.ceil(candidates.length / approachStages));
    const bandFromTarget = approachStages - 1 - stage;
    const start = Math.min(Math.max(0, candidates.length - 1), bandFromTarget * bandSize);
    const band = candidates.slice(start, Math.min(candidates.length, start + bandSize));
    const pool = band.length > 0 ? band : candidates;
    const seed = hashString(`${mission.id}:${hunterName.toLowerCase()}:${stage}:${target}`);
    return pool[seed % pool.length] ?? target;
}
