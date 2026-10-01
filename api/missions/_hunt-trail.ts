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
    { id: 'blood-trail', kicker: 'Blood sign', prose: 'Dark blood beads along the fern-tips, still tacky. Whatever bled here was moving fast and not bothering to hide it.', choices: [
        { id: 'push', label: 'Push the blood trail', detail: 'Run it down before the bleeding stops. Tire the beast before the final fight.', risk: 'It knows it is being chased; there is a 35% chance the pack springs first.', outcome: { quality: 1, advances: true, ambushChance: .35 } },
        { id: 'downwind', label: 'Circle downwind', detail: 'Lose some pace to keep your scent off the trail. The pack will not hear you coming.', risk: '', outcome: { quality: 0, advances: true, ambushChance: 0 } },
    ] },
    { id: 'lair', kicker: 'Lair sign', prose: 'A hollow under the root-shelf, packed flat and rank with musk. Something big sleeps here between kills.', choices: [
        { id: 'wait', label: 'Lie in wait', detail: 'Take the hollow and hold still. The beast returns on ground you chose.', risk: '', outcome: { quality: 1, advances: true, ambushChance: 0 } },
        { id: 'smoke', label: 'Smoke it out', detail: 'Seal the exits with fire and force the target into the open. A clean flush leaves it badly placed for the final fight.', risk: 'The smoke carries far: 20% chance the pack closes in, but this route can corner the target.', outcome: { quality: 2, advances: true, ambushChance: .2 } },
    ] },
    { id: 'fork', kicker: 'The trail forks', prose: 'Two sets of tracks leave the streambed. One is deep, dragging, and favours a side. The other is light and even — and there are several of them.', choices: [
        { id: 'heavy', label: 'Follow the dragging track', detail: 'Deep and uneven means weight and a bad leg. That is your contract.', risk: '', outcome: { quality: 1, advances: true, ambushChance: 0 } },
        { id: 'light', label: 'Follow the light tracks', detail: 'Cut through the fresher tracks to close quickly on the target.', risk: 'Several sets rarely mean one animal: 30% chance the pack catches you in its feeding ground.', outcome: { quality: 2, advances: true, ambushChance: .3 } },
    ] },
    { id: 'pack-sign', kicker: 'You are not alone', prose: 'Scat, claw-scores on the bark at two different heights, and a half-eaten kill nobody bothered to bury. More than one animal works this ground.', choices: [
        { id: 'press', label: 'Press through the pack ground', detail: 'Keep on the target’s trail and use the noise to close the gap.', risk: 'They are already circling: 55% chance the pack attacks before you reach the target.', outcome: { quality: 1, advances: true, ambushChance: .55 } },
        { id: 'withdraw', label: 'Flank around the pack', detail: 'Give up the clean approach and keep tracking from outside their hearing.', risk: '', outcome: { quality: 0, advances: true, ambushChance: 0 } },
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

/**
 * The contract target is always one creature. A pack ambush is always three
 * creatures, the same number of fights the old three-stage chain asked for,
 * either arriving one after another (waves) or all at once (pack).
 */
export function huntFormationFor(runId: string, kind: string, decisionId = ''): import('../../shared/hunt-combat.js').HuntFormation {
    if (kind !== 'hunt-pack') return { version: 1, kind: 'single', count: 1 };
    return { version: 1, kind: ((huntHash(`${runId}:${kind}:${decisionId}:formation-v2`) >>> 16) & 1) === 0 ? 'waves' : 'pack', count: 3 };
}
