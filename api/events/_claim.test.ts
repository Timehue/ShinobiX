import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AURA_SPHERE_ITEM_ID, claimBuiltinEvent } from './_claim.js';

describe('built-in event claims', () => {
    it('grants the Aura Sphere once at level nine', () => {
        const first = claimBuiltinEvent({ level: 9, inventory: [], equipment: {} }, 'builtin-aura-sphere-lv9');
        assert.equal(first.ok, true);
        if (!first.ok) return;
        assert.deepEqual((first.character as Record<string, unknown>).inventory, [AURA_SPHERE_ITEM_ID]);
        const replay = claimBuiltinEvent(first.character, 'builtin-aura-sphere-lv9');
        assert.equal(replay.ok, true);
        if (replay.ok) assert.equal(replay.alreadyClaimed, true);
    });

    it('rejects early and user-authored reward payload ids', () => {
        assert.equal(claimBuiltinEvent({ level: 8 }, 'builtin-aura-sphere-lv9').ok, false);
        assert.equal(claimBuiltinEvent({ level: 100 }, 'event-forged-million-ryo').ok, false);
    });
});
