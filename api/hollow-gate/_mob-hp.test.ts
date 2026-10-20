import assert from 'node:assert/strict';
import { test } from 'node:test';
import { balanceSave } from '../../scripts/test-fixtures/hunt-shrine.js';
import { createHollowGateCombatBinding, type HollowGateCombatKind } from './_combat-session.js';
import { buildHollowGateSoloPveEncounter } from './_encounter.js';
import type { HollowGateRunToken } from './_run-token.js';

function encounter(level: number, floor: number, kind: HollowGateCombatKind, overrides: Partial<HollowGateRunToken> = {}) {
    const run: HollowGateRunToken = { playerName: 'fixture', mintedAt: 1, floorDepth: 5, currentFloor: floor,
        seed: 'hp-control', entryCurrencies: {}, offeredAugmentIds: [], chosenAugmentId: null, dailyRunOrdinal: 1, ...overrides };
    const binding = createHollowGateCombatBinding({ playerName: run.playerName, token: 'offline', floor,
        nodeId: `floor:${floor}:tile:20`, kind, runId: 'hp-control', now: 1000 });
    return buildHollowGateSoloPveEncounter({ binding, run, save: balanceSave(level, false), now: 1000, admin: null });
}

test('actual new mob HP includes difficulty scaling exactly once across progression and depth; final bosses stay unchanged', () => {
    // Actual built-session HP, rather than the unscaled profile. Boss expectations
    // are captured from main before this patch; floor-two mob baselines were
    // [855,924,984,1196], [2068,2233,2378,2883], [4575,4941,5262,6359],
    // [8674,9369,9976,12007], [16218,17515,18650,22323].
    const controls = [
        { level: 1, hp: [305, 329, 351, 393], finalBoss: 3036 },
        { level: 5, hp: [556, 600, 639, 717], finalBoss: 3678 },
        { level: 17, hp: [1344, 1452, 1545, 1730], finalBoss: 6433 },
        { level: 35, hp: [2974, 3212, 3420, 3815], finalBoss: 10056 },
        { level: 60, hp: [5638, 6089, 6484, 7204], finalBoss: 16813 },
        { level: 100, hp: [10541, 11385, 12122, 13394], finalBoss: 24360 },
    ];
    for (const { level, hp, finalBoss } of controls) {
        for (const [index, kind] of (['battle', 'ambush', 'beast', 'elite'] as const).entries()) {
            const s = encounter(level, 2, kind);
            assert.equal(s.enemy.maxHp, hp[index], `${level}:${kind}`);
            assert.equal(s.enemy.hp, s.enemy.maxHp);
        }
        assert.equal(encounter(level, 5, 'boss').enemy.maxHp, finalBoss, `boss:${level}`);
    }
    assert.deepEqual((['battle', 'ambush', 'beast', 'elite'] as const).map(kind => encounter(100, 5, kind).enemy.maxHp),
        [12331, 13318, 14181, 15668], 'standard deepest-floor mobs remain below 16,000 HP, with elite above beast');
});

test('Rift and augment HP apply once, named bosses retain their original HP, and authored hunters receive mob relief', () => {
    assert.equal(encounter(100, 2, 'elite', { variantId: 'rift-hollow-stalker', chosenAugmentId: 'keen-edge' }).enemy.maxHp,
        10045, 'the 16,742 HP Rift/Keen Edge control becomes 10,045');
    const controls = [
        { chosenAugmentId: null, elite: 13394, boss: 24360 },
        { chosenAugmentId: 'keen-edge', elite: 11161, boss: 20300 },
        { chosenAugmentId: 'greedy-pact', elite: 17412, boss: 31668 },
    ];
    for (const { chosenAugmentId, elite, boss } of controls) {
        assert.equal(encounter(100, 2, 'elite', { chosenAugmentId }).enemy.maxHp, elite);
        assert.equal(encounter(100, 5, 'boss', { chosenAugmentId, variantId: 'rift-hollow-stalker', bossName: 'Named Warden' }).enemy.maxHp, boss);
    }
    // Greedy Pact deliberately retains its disclosed +30% enemy-power risk.
    for (const role of ['bandit', 'night-ninja', 'patrol'] as const) {
        const s = encounter(100, 2, 'battle', { wanderers: { '2': [{ role, nodeId: 'floor:2:tile:20', origin: 20, tile: 20 }] } });
        assert.equal(s.enemy.maxHp, 10541);
        assert.equal(s.shrineAi?.healLimit, 1);
    }
});
