import { describe, it } from 'node:test'; import { strict as assert } from 'node:assert'; import { DUNGEON_MIN_RUN_MS, mutateDungeonRun, resolveFreeDungeonMiss } from './_run.js';
import { applyDungeonWardenSettlement } from './_ai-fight.js';
describe('dungeon run authority', () => {
    it('consumes one key and settles once after the sealed duration', () => {
        const start = mutateDungeonRun({ inventory: ['dungeon-key'], itemStacks: [] }, 'start', '', 'token12345', 1000); assert.equal(start.ok, true); if (!start.ok) return;
        assert.deepEqual(start.character.inventory, []);
        assert.equal(mutateDungeonRun(start.character, 'settle', 'token12345', 'x', 1000 + DUNGEON_MIN_RUN_MS - 1).ok, false);
        const unproved = mutateDungeonRun(start.character, 'settle', 'token12345', 'x', 1000 + DUNGEON_MIN_RUN_MS);
        assert.equal(unproved.ok, false);
        const proved = applyDungeonWardenSettlement({ character: start.character, dungeonRunToken: 'token12345', opponentId: 'dungeon-warden-50', proofId: 'aifightproof123', outcome: 'win', now: 2000 });
        assert.equal(proved.ok, true); if (!proved.ok) return;
        const settled = mutateDungeonRun(proved.character, 'settle', 'token12345', 'x', 1000 + DUNGEON_MIN_RUN_MS); assert.equal(settled.ok, true); if (!settled.ok) return;
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
        const miss = mutateDungeonRun(base, 'probe-free', '', 'miss-token', Date.UTC(2026, 7, 7), 0.5, 66, 'dungeonprobe0001');
        assert.equal(miss.ok, true); if (!miss.ok) return;
        assert.equal(miss.found, false);
        assert.equal(miss.character.serverFreeDungeonProbesToday, 1);
        const crossDevice = mutateDungeonRun(miss.character, 'probe-free', '', 'reroll-token', Date.UTC(2026, 7, 7), 0, 1, 'dungeonprobe0002');
        assert.equal(crossDevice.ok, true); if (!crossDevice.ok) return;
        assert.equal(crossDevice.found, false);
        assert.equal(crossDevice.requestId, 'dungeonprobe0001');
        assert.equal(crossDevice.sector, 66);
        const resolved = resolveFreeDungeonMiss(miss.character, 'dungeonprobe0001', Date.UTC(2026, 7, 7) + 1);
        const earned = { ...resolved, serverExploresToday: 1 };
        const hit = mutateDungeonRun(earned, 'probe-free', '', 'free-token', Date.UTC(2026, 7, 7) + 2, 0.01, 61, 'dungeonprobe0002');
        assert.equal(hit.ok, true); if (!hit.ok) return;
        assert.equal(hit.found, true);
        assert.equal((hit.character.activeDungeonRun as Record<string, unknown>).entry, 'free');
        assert.equal((hit.character.activeDungeonRun as Record<string, unknown>).sector, 61);
    });
    it('rejects invalid World sectors and key-entry recovery as a free probe', () => {
        for (const sector of [0, -1, 67, 99]) {
            const out = mutateDungeonRun({ level: 50 }, 'probe-free', '', 'token12345', 1000, 0, sector, `probeinvalid${Math.abs(sector)}`);
            assert.equal(out.ok, false, `sector ${sector}`);
        }
        const conflict = mutateDungeonRun({ level: 50, activeDungeonRun: { token: 'keytoken123', entry: 'key' } }, 'probe-free', '', 'free-token', 1000, 0, 1, 'probeconflict01');
        assert.equal(conflict.ok, false);
        if (!conflict.ok) assert.equal(conflict.reason, 'active-dungeon-conflict');
    });
});
