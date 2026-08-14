import { FESTIVAL_SECTOR, WILD_SECTOR_IDS, isWildSector, sectorBiomeOf } from '../../shared/sector-geo.js';
import type { FieldMissionDef } from './_mission-catalog.js';

export const HUNT_QUALITY_MIN = -3;
export const HUNT_QUALITY_MAX = 3;

export type ServerHuntChoice = {
    id: string;
    label: string;
    detail: string;
    risk: string;
    outcome: { quality: number; advances: boolean; ambushChance: number };
};

export type ServerHuntSign = { id: string; kicker: string; prose: string; choices: ServerHuntChoice[] };

const SIGNS: readonly ServerHuntSign[] = [
    { id: 'blood-trail', kicker: 'Blood sign', prose: 'Dark blood beads along the fern-tips, still tacky.', choices: [
        { id: 'push', label: 'Push the blood trail', detail: 'Run it down before the bleeding stops.', risk: 'It knows it is being chased.', outcome: { quality: 1, advances: true, ambushChance: .35 } },
        { id: 'downwind', label: 'Circle downwind', detail: 'Give up the pace to keep your scent off it.', risk: '', outcome: { quality: 0, advances: true, ambushChance: 0 } },
    ] },
    { id: 'lair', kicker: 'Lair sign', prose: 'A hollow under the root-shelf is packed flat and rank with musk.', choices: [
        { id: 'wait', label: 'Lie in wait', detail: 'Take the hollow and hold still.', risk: '', outcome: { quality: 1, advances: true, ambushChance: 0 } },
        { id: 'smoke', label: 'Smoke it out', detail: 'Fire the bracken and force it into the open.', risk: 'Every animal within a mile will move.', outcome: { quality: -1, advances: true, ambushChance: .2 } },
    ] },
    { id: 'fork', kicker: 'The trail forks', prose: 'One track is deep and dragging; the other is light and several-fold.', choices: [
        { id: 'heavy', label: 'Follow the dragging track', detail: 'Deep and uneven means weight and a bad leg.', risk: '', outcome: { quality: 1, advances: true, ambushChance: 0 } },
        { id: 'light', label: 'Follow the light tracks', detail: 'Fresher, easier to read, and there are more of them.', risk: 'Several sets rarely means one animal.', outcome: { quality: -1, advances: true, ambushChance: .3 } },
    ] },
    { id: 'pack-sign', kicker: 'You are not alone', prose: 'Claw-scores at two heights mark pack ground.', choices: [
        { id: 'press', label: 'Press on regardless', detail: 'Walk through them if you have to.', risk: 'They are already circling.', outcome: { quality: 1, advances: true, ambushChance: .55 } },
        { id: 'withdraw', label: 'Withdraw and re-read', detail: 'Back out clean and pick the trail up elsewhere.', risk: 'No progress.', outcome: { quality: 0, advances: false, ambushChance: 0 } },
    ] },
];

export function huntHash(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function serverHuntSign(missionId: string, stage: number, hunterName: string): ServerHuntSign {
    const safeStage = Math.max(0, Math.floor(Number(stage) || 0));
    return SIGNS[huntHash(`${missionId}:${hunterName.toLowerCase()}:sign:${safeStage}`) % SIGNS.length]!;
}

export function huntRequiredTracks(mission: Pick<FieldMissionDef, 'exploreCount'>): number {
    return Math.max(1, Math.floor(Number(mission.exploreCount) || 1));
}

export function serverHuntTrailSector(
    mission: Pick<FieldMissionDef, 'id' | 'targetSector' | 'exploreCount'>,
    progress: number,
    hunterName: string,
): number {
    const target = Math.max(1, Math.min(60, Math.floor(Number(mission.targetSector) || 1)));
    const required = huntRequiredTracks(mission);
    const stage = Math.max(0, Math.min(required - 1, Math.floor(Number(progress) || 0)));
    if (stage >= required - 1) return target;
    const candidates = WILD_SECTOR_IDS
        // Built-in Hunter Guild contracts are authored on the legacy 1..60
        // contract map. General World encounters support expansion sectors
        // through MAX_WILD_SECTOR, but a sign never routes this authored trail
        // into 61..66 (client mirrors this intentionally).
        .filter((sector) => sector <= 60 && isWildSector(sector) && sector !== FESTIVAL_SECTOR)
        .filter((sector) => sector !== target && sectorBiomeOf(sector) === sectorBiomeOf(target))
        .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    if (candidates.length === 0) return target;
    const approachStages = Math.max(1, required - 1);
    const bandSize = Math.max(1, Math.ceil(candidates.length / approachStages));
    const bandFromTarget = approachStages - 1 - stage;
    const start = Math.min(candidates.length - 1, bandFromTarget * bandSize);
    const band = candidates.slice(start, Math.min(candidates.length, start + bandSize));
    const pool = band.length > 0 ? band : candidates;
    return pool[huntHash(`${mission.id}:${hunterName.toLowerCase()}:${stage}:${target}`) % pool.length] ?? target;
}

export function deterministicHuntAmbush(
    playerName: string,
    runId: string,
    stage: number,
    choiceId: string,
    chance: number,
): boolean {
    const p = Math.max(0, Math.min(1, Number(chance) || 0));
    if (p <= 0) return false;
    return huntHash(`${playerName.toLowerCase()}:${runId}:${stage}:${choiceId}:ambush`) / 0x1_0000_0000 < p;
}

export function clampHuntQuality(value: unknown): number {
    return Math.max(HUNT_QUALITY_MIN, Math.min(HUNT_QUALITY_MAX, Math.floor(Number(value) || 0)));
}
