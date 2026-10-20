import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hollowGateCombatDirective } from './hollow-gate-combat-director';
import { hollowGateSessionDirective, sealHollowGateTelegraph } from './hollow-gate-telegraph';

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

test('the shared saved telegraph keeps named opponents clear without changing the advertised hazards', () => {
    for (const visual of ['rift-boss-legacy-echo', 'shinobi']) {
        const state = {
            round: 3,
            encounter: { kind: 'hollow-gate', metadata: { floor: 5, combatKind: 'boss' } },
            player: { pos: 4 },
            enemy: { name: 'Archive Warden', hp: 60, maxHp: 100, pos: 30, character: { visual } },
        };
        const announced = hollowGateSessionDirective(state)!;
        assert.doesNotMatch([announced.title, announced.instruction, announced.signature].join(' '), /Alpha|Hound|paws|pounce/i);
        sealHollowGateTelegraph(state);
        state.enemy.hp = 20;
        state.player.pos = 9;
        const sealed = hollowGateSessionDirective(state)!;
        assert.deepEqual(sealed, announced, 'the label fix must preserve the exact cue already shown for this turn');
    }
});
