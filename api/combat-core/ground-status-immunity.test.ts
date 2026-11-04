import { strict as assert } from 'node:assert';
import { it } from 'node:test';
import { removeActiveCombatStatusesByKind, removeCombatStatusesByKind } from './statuses.js';
import type { CombatStatus } from './types.js';

it('Clear and Cleanse preserve ground sources, including same-name and pending effects', () => {
    for (const kind of ['positive', 'negative'] as const) {
        const ground: CombatStatus = { name: 'Reflect', kind, rounds: 2, source: 'ground:tile' };
        const pendingGround = { ...ground, source: 'ground:pending', activeRound: 2 };
        const direct = { ...ground, source: 'jutsu:ground:direct' };
        const pendingDirect = { ...direct, activeRound: 2 };
        const otherKind: CombatStatus = { ...direct, kind: kind === 'positive' ? 'negative' : 'positive' };
        const statuses = [ground, pendingGround, direct, pendingDirect, otherKind];
        const clear = removeActiveCombatStatusesByKind(statuses, kind, 1);
        assert.deepEqual(clear.removed, [direct]);
        assert.deepEqual(clear.statuses, [ground, pendingGround, pendingDirect, otherKind]);
        const cleanse = removeCombatStatusesByKind(statuses, kind);
        assert.deepEqual(cleanse.removed, [direct, pendingDirect]);
        assert.deepEqual(cleanse.statuses, [ground, pendingGround, otherKind]);
        assert.equal(clear.statuses[0], ground, 'ground status is retained rather than recreated');
        assert.equal(cleanse.statuses[0], ground);
        assert.equal(statuses.length, 5, 'input is unchanged');
    }
});
