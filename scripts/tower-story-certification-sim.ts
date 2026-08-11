/*
 * Story Tower certification sim.
 *
 * Models a party that grows alongside the sequential F1-F10 unlock path instead of
 * testing only L75/endgame loadouts. It drives the real encounter, canonical resolver,
 * authored enemy AI, waves, objectives, hazards, and phase mechanics through the same
 * coordinated squad policy used by the Spire release simulation.
 *
 *   node --import tsx scripts/tower-story-certification-sim.ts [seeds]
 */
import { pathToFileURL } from 'node:url';
import { buildTowerEncounter, type SquadMemberInput } from '../api/towers/_encounter.js';
import { FLOOR_CATALOG } from '../api/towers/_floor-catalog.js';
import { makeRng } from '../api/towers/_sim.js';
import { runFloorSmart } from './spire-balance-sim.js';

export type StoryCertificationResult = {
    wins: number;
    seeds: number;
    winPct: number;
    avgRounds: number;
    avgSurvivors: number;
    avgHpPct: number;
    /** Average protected-NPC health on successful defense/escort runs; null on other floors. */
    avgNpcHpPct: number | null;
    timeoutLosses: number;
    wipeLosses: number;
};

/** A plausible sequential climber: L32 on F1, reaching L68 / near-cap gear on F10. */
export function advancingStorySquad(partySize: number, floorId: number): SquadMemberInput[] {
    const step = Math.max(1, Math.min(10, Math.floor(floorId)));
    const level = 28 + step * 4;
    const stat = 900 + step * 140;
    const maxHp = 3_500 + step * 550;
    const maxResource = 550 + step * 115;
    const stats: Record<string, number> = {
        taijutsuOffense: stat, taijutsuDefense: stat,
        bukijutsuOffense: stat, bukijutsuDefense: stat,
        genjutsuOffense: stat, genjutsuDefense: stat,
        ninjutsuOffense: stat, ninjutsuDefense: stat,
        strength: stat, speed: stat, intelligence: stat, willpower: stat,
    };
    const jutsu = [
        { id: 'story-burst', name: 'Focused Burst', effectPower: 25 + step * 2, ap: 60, range: 4, type: 'Ninjutsu', chakraCost: 18 },
        { id: 'story-combo', name: 'Squad Fang', effectPower: 21 + step * 1.6, ap: 40, range: 2, type: 'Bukijutsu', staminaCost: 10 },
        { id: 'story-palm', name: 'Guarded Palm', effectPower: 17 + step * 1.2, ap: 30, range: 1, type: 'Taijutsu', staminaCost: 5 },
    ];
    return Array.from({ length: partySize }, (_, index) => ({
        id: `story-${index}`,
        name: `StoryHero${index}`,
        ownerSlug: `storyhero${index}`,
        ai: true,
        character: {
            level, maxHp, maxChakra: maxResource, maxStamina: maxResource,
            stats, jutsu,
            bloodlineMult: 1.05 + step * 0.025,
            armorRawDR: 0.15 + step * 0.05,
            itemDamagePct: 4 + step * 1.5,
            itemAbsorbPct: 2 + step * 0.5,
            itemReflectPct: 1 + step * 0.3,
            itemLifeStealPct: 2 + step * 0.5,
        },
    }));
}

export function certifyStoryFloor(floorId: number, partySize: number, seeds = 16): StoryCertificationResult {
    const floor = FLOOR_CATALOG.find(entry => entry.id === floorId);
    if (!floor) throw new Error(`Unknown Story floor ${floorId}`);
    let wins = 0, rounds = 0, survivors = 0, hpPct = 0, npcHpPct = 0, npcSamples = 0;
    let timeoutLosses = 0, wipeLosses = 0;
    for (let sample = 0; sample < seeds; sample++) {
        const seed = 20_000 + floor.id * 101 + partySize * 17 + sample * 31;
        const session = buildTowerEncounter({
            floor,
            squad: advancingStorySquad(partySize, floor.id),
            runId: `story-cert-${floor.id}-${partySize}-${sample}`,
            seed,
            partySize,
            now: 0,
        });
        runFloorSmart(session, floor, makeRng(seed));
        const squad = session.actors.filter(actor => actor.side === 'squad');
        const alive = squad.filter(actor => actor.hp > 0);
        if (session.winner === 'squad') {
            wins++;
            rounds += session.round;
            survivors += alive.length;
            const left = alive.reduce((sum, actor) => sum + actor.hp, 0);
            const max = squad.reduce((sum, actor) => sum + actor.maxHp, 0);
            hpPct += max > 0 ? (left / max) * 100 : 0;
            const npc = session.actors.find(actor => actor.side === 'npc');
            if (npc) {
                npcHpPct += npc.maxHp > 0 ? (npc.hp / npc.maxHp) * 100 : 0;
                npcSamples++;
            }
        } else if (alive.length === 0) wipeLosses++;
        else timeoutLosses++;
    }
    return {
        wins,
        seeds,
        winPct: Math.round((wins / seeds) * 100),
        avgRounds: wins ? Math.round((rounds / wins) * 10) / 10 : 0,
        avgSurvivors: wins ? Math.round((survivors / wins) * 10) / 10 : 0,
        avgHpPct: wins ? Math.round((hpPct / wins) * 10) / 10 : 0,
        avgNpcHpPct: npcSamples ? Math.round((npcHpPct / npcSamples) * 10) / 10 : null,
        timeoutLosses,
        wipeLosses,
    };
}

export function runStoryCertificationReport(seeds = 16): void {
    console.log(`Story Tower progression certification - ${seeds} seeds/floor/party`);
    console.log('Floor Party Win% AvgRnd Survivors HP-left NPC-left Losses');
    for (const floor of FLOOR_CATALOG) {
        for (const partySize of [1, 2, 3, 4]) {
            const result = certifyStoryFloor(floor.id, partySize, seeds);
            console.log(
                `F${String(floor.id).padStart(2)}   ${partySize}p   ${String(result.winPct).padStart(3)}%   `
                + `${String(result.avgRounds).padStart(5)}   ${String(result.avgSurvivors).padStart(4)}   `
                + `${String(result.avgHpPct).padStart(5)}%   `
                + `${result.avgNpcHpPct == null ? '   —  ' : `${String(result.avgNpcHpPct).padStart(5)}%`}   `
                + `W${result.wipeLosses}/T${result.timeoutLosses}`,
            );
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runStoryCertificationReport(Math.max(1, Number(process.argv[2]) || 16));
}
