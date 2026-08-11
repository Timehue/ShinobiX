import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTowerEncounter, type SquadMemberInput } from '../api/towers/_encounter.js';
import { FLOOR_CATALOG } from '../api/towers/_floor-catalog.js';
import { makeRng } from '../api/towers/_sim.js';
import { gearedSquad, runFloorSmart } from './spire-balance-sim.js';
import { certifyStoryFloor } from './tower-story-certification-sim.js';

function coordinatedMidBandSquad(n: number): SquadMemberInput[] {
    const stat = 1_800;
    const stats: Record<string, number> = {
        taijutsuOffense: stat, taijutsuDefense: stat, bukijutsuOffense: stat, bukijutsuDefense: stat,
        genjutsuOffense: stat, genjutsuDefense: stat, ninjutsuOffense: stat, ninjutsuDefense: stat,
        strength: stat, speed: stat, intelligence: stat, willpower: stat,
    };
    const jutsu = [
        { id: 'mid-nuke', name: 'Focused Burst', effectPower: 42, ap: 60, range: 4, type: 'Ninjutsu', chakraCost: 20 },
        { id: 'mid-strike', name: 'Coordinated Fang', effectPower: 34, ap: 40, range: 2, type: 'Bukijutsu', staminaCost: 12 },
        { id: 'mid-jab', name: 'Measured Palm', effectPower: 25, ap: 30, range: 1, type: 'Taijutsu', staminaCost: 6 },
    ];
    return Array.from({ length: n }, (_, i) => ({
        id: `mid-${i}`, name: `MidHero${i}`, ownerSlug: `midhero${i}`, ai: true,
        character: {
            maxHp: 8_000, maxChakra: 1_500, maxStamina: 1_500, level: 75,
            stats, jutsu,
            bloodlineMult: 1.25, armorRawDR: 0.65, itemDamagePct: 18,
            itemAbsorbPct: 6, itemReflectPct: 4, itemLifeStealPct: 6,
        },
    }));
}

describe('Battle Towers story release balance', () => {
    it('keeps sequentially advancing L32-L68 squads meaningful across every live party size', () => {
        // Minimum fraction of each floor's authored round budget a coordinated full squad should
        // actually use. This guards against a 100%-win result hiding a two-round faceroll.
        const minRoundUtilization: Record<number, number> = {
            1: 0.45, 2: 0.55, 3: 0.60, 4: 0.95, 5: 0.75,
            6: 0.45, 7: 0.50, 8: 0.50, 9: 0.55, 10: 0.45,
        };
        for (const partySize of [2, 3, 4]) {
            for (const floor of FLOOR_CATALOG) {
                const result = certifyStoryFloor(floor.id, partySize, 8);
                assert.equal(result.wins, result.seeds,
                    `F${floor.id} stays sequentially clearable for an advancing ${partySize}p squad`);
                assert.equal(result.wipeLosses + result.timeoutLosses, 0, `F${floor.id} ${partySize}p has no hidden wall`);
                if (partySize === 4) {
                    assert.ok(result.avgRounds >= floor.roundBudget * minRoundUtilization[floor.id]!,
                        `F${floor.id} must consume meaningful board time (${result.avgRounds}/${floor.roundBudget})`);
                    if (floor.boss) assert.ok(result.avgHpPct < 92,
                        `F${floor.id} boss should meaningfully pressure squad health (${result.avgHpPct}% remains)`);
                }
            }
        }
    });

    it('keeps legacy solo practice useful for onboarding but honestly walls at squad checkpoints', () => {
        for (const floorId of [1, 2, 3]) {
            const result = certifyStoryFloor(floorId, 1, 8);
            assert.ok(result.winPct >= 50, `F${floorId} solo practice remains useful (${result.winPct}%)`);
        }
        for (const floorId of [5, 7]) {
            const result = certifyStoryFloor(floorId, 1, 8);
            assert.ok(result.winPct <= 50, `F${floorId} remains an honest bring-a-squad checkpoint (${result.winPct}%)`);
        }
    });

    it('keeps defense and escort NPCs under visible but survivable pressure', () => {
        for (const floorId of [4, 8]) {
            for (const partySize of [2, 3, 4]) {
                const result = certifyStoryFloor(floorId, partySize, 8);
                assert.equal(result.wins, result.seeds,
                    `F${floorId} protected NPC remains defendable by an advancing ${partySize}p squad`);
                assert.notEqual(result.avgNpcHpPct, null, `F${floorId} reports protected-NPC health`);
                assert.ok(result.avgNpcHpPct! >= 40,
                    `F${floorId} NPC pressure stays survivable (${result.avgNpcHpPct}% remains)`);
                assert.ok(result.avgNpcHpPct! < 95,
                    `F${floorId} must put visible pressure on its protected NPC (${result.avgNpcHpPct}% remains)`);
            }
        }
    });

    it('keeps every authored floor clearable by coordinated geared duo, trio, and full squads', () => {
        for (const partySize of [2, 3, 4]) {
            for (const floor of FLOOR_CATALOG) {
                for (let sample = 0; sample < 4; sample++) {
                    const seed = 1_000 + floor.id * 17 + sample;
                    const session = buildTowerEncounter({
                        floor,
                        squad: gearedSquad(partySize),
                        runId: `story-balance-${partySize}-${floor.id}-${sample}`,
                        seed,
                        partySize,
                        now: 0,
                    });
                    runFloorSmart(session, floor, makeRng(seed));
                    assert.equal(session.status, 'done', `F${floor.id} ${partySize}p seed ${seed} terminates`);
                    assert.equal(
                        session.winner,
                        'squad',
                        `F${floor.id} remains clearable by a coordinated geared ${partySize}-player squad (seed ${seed})`,
                    );
                }
            }
        }
    });

    it('keeps early floors broadly approachable and prevents a coordinated four-player mid-band hard wall', () => {
        const samples = 8;
        for (const authoredFloor of FLOOR_CATALOG) {
            let wins = 0;
            for (let sample = 0; sample < samples; sample++) {
                const seed = 4_000 + authoredFloor.id * 31 + sample * 7;
                const run = buildTowerEncounter({
                    floor: authoredFloor,
                    squad: coordinatedMidBandSquad(4),
                    runId: `story-mid-band-${authoredFloor.id}-${sample}`,
                    seed,
                    partySize: 4,
                    now: 0,
                });
                runFloorSmart(run, authoredFloor, makeRng(seed));
                assert.equal(run.status, 'done', `F${authoredFloor.id} mid-band seed ${seed} terminates`);
                if (run.winner === 'squad') wins++;
            }
            assert.ok(wins > 0, `F${authoredFloor.id} must not be a 0/${samples} deterministic mid-band hard wall`);
            if (authoredFloor.id <= 4) {
                assert.ok(wins >= Math.ceil(samples / 2),
                    `F${authoredFloor.id} early story should clear in at least half the mid-band seed set (${wins}/${samples})`);
            }
        }
    });
});
