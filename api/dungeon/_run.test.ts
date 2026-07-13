import { describe, it } from 'node:test'; import { strict as assert } from 'node:assert'; import { DUNGEON_MIN_RUN_MS, mutateDungeonRun } from './_run.js';
describe('dungeon run authority', () => {
    it('consumes one key and settles once after the sealed duration', () => {
        const start = mutateDungeonRun({ inventory: ['dungeon-key'], itemStacks: [] }, 'start', '', 'token12345', 1000); assert.equal(start.ok, true); if (!start.ok) return;
        assert.deepEqual(start.character.inventory, []);
        assert.equal(mutateDungeonRun(start.character, 'settle', 'token12345', 'x', 1000 + DUNGEON_MIN_RUN_MS - 1).ok, false);
        const settled = mutateDungeonRun(start.character, 'settle', 'token12345', 'x', 1000 + DUNGEON_MIN_RUN_MS); assert.equal(settled.ok, true); if (!settled.ok) return;
        assert.equal(settled.character.fateShards, 5); assert.deepEqual(settled.character.inventory, ['dungeon-legendary-relic']);
        const replay = mutateDungeonRun(settled.character, 'settle', 'token12345', 'x', 999999); assert.equal(replay.ok, true); if (replay.ok) assert.equal(replay.alreadyApplied, true);
    });
    it('rejects keyless starts and supports abandon without payout', () => {
        assert.equal(mutateDungeonRun({ inventory: [] }, 'start', '', 'token12345').ok, false);
        const start = mutateDungeonRun({ itemStacks: [{ itemId: 'dungeon-key', count: 2 }] }, 'start', '', 'token12345', 1); assert.equal(start.ok, true); if (!start.ok) return;
        const abandoned = mutateDungeonRun(start.character, 'abandon', 'token12345', 'x', 2); assert.equal(abandoned.ok, true); if (abandoned.ok) assert.equal(abandoned.character.activeDungeonRun, null);
    });
});
