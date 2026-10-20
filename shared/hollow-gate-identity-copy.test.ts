import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hollowGateCombatDirective } from './hollow-gate-combat-director';

test('rift and human enemies get floor announcements without inheriting a Hollow Hound identity', () => {
    for (let floor = 1; floor <= 5; floor++) for (let turn = 1; turn <= 6; turn++) for (const hp of [100, 60, 20]) {
        const input = { floor, kind: floor === 5 ? 'boss' as const : 'battle' as const,
            turn, enemyHp: hp, enemyMaxHp: 100, playerPos: 4, enemyPos: 30 };
        const original = hollowGateCombatDirective(input);
        for (const enemyVisual of ['rift-boss-legacy-echo', 'shinobi']) {
            const corrected = hollowGateCombatDirective({ ...input, enemyVisual });
            assert.doesNotMatch([corrected.title, corrected.instruction, corrected.signature].join(' '), /Alpha|Hound|Ashfang|Veilrunner|Shrineback|Riftmaw|paws|pounce/i);
            for (const key of ['phase', 'hazardTiles', 'safeTiles', 'hazardDamagePct', 'incomingDamageMultiplier', 'outgoingDamageMultiplier'] as const)
                assert.deepEqual(corrected[key], original[key], `${enemyVisual}/${floor}/${turn}/${hp}/${key}`);
        }
    }
});
