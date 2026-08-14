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
    it('server-rolls one free probe per explored tile and seals a winning probe', () => {
        const base = { level: 50, serverExploreDate: '2026-08-07', serverExploresToday: 0 };
        const miss = mutateDungeonRun(base, 'probe-free', '', 'miss-token', Date.UTC(2026, 7, 7), 0.5);
        assert.equal(miss.ok, true); if (!miss.ok) return;
        assert.equal(miss.found, false);
        assert.equal(miss.character.serverFreeDungeonProbesToday, 1);
        assert.equal(mutateDungeonRun(miss.character, 'probe-free', '', 'blocked', Date.UTC(2026, 7, 7), 0).ok, false);
        const earned = { ...miss.character, serverExploresToday: 1 };
        const hit = mutateDungeonRun(earned, 'probe-free', '', 'free-token', Date.UTC(2026, 7, 7), 0.01);
        assert.equal(hit.ok, true); if (!hit.ok) return;
        assert.equal(hit.found, true);
        assert.equal((hit.character.activeDungeonRun as Record<string, unknown>).entry, 'free');
    });
});
