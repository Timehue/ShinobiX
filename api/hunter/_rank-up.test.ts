import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { rankUpHunter } from './_rank-up.js';

describe('Hunter Rank authority', () => {
    it('atomically consumes inventory and stack materials', () => {
        const out = rankUpHunter({ hunterRank: 0, inventory: ['hunt-beast-meat', 'x'], itemStacks: [{ itemId: 'hunt-beast-meat', count: 4 }] }, 'hunter_action_01');
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.character.hunterRank, 1);
        assert.deepEqual(out.character.inventory, ['x']);
        assert.deepEqual(out.character.itemStacks, []);
    });

    it('rejects missing materials and is replay-safe', () => {
        assert.equal(rankUpHunter({ hunterRank: 0, inventory: [] }, 'hunter_action_02').ok, false);
        const once = rankUpHunter({ hunterRank: 0, inventory: Array(5).fill('hunt-beast-meat') }, 'hunter_action_03');
        assert.equal(once.ok, true);
        if (!once.ok) return;
        const replay = rankUpHunter(once.character, 'hunter_action_03');
        assert.equal(replay.ok, true);
        if (replay.ok) assert.equal(replay.alreadyApplied, true);
    });
});
